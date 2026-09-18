"""
api/routes/execute.py — POST /execute and POST /execute-batch endpoints.

Pipeline (single):
  1. Parse the raw stdin (strip prose, format correctly).
  2. Instrument the user's C++ source (inject trace calls).
  3. Run the instrumented binary in the Docker sandbox.
  4. Parse the TRACE: lines into typed events.
  5. Build a CFG from the events.
  6. Return everything in one response (JSON or NDJSON streaming).

Single-endpoint flow: the user provides code + raw_stdin, the server
handles stdin cleaning and execution in one shot.

Efficiency (task 22, warm-instance-only):
  Disk LRU under /tmp/algo-theseus-cache (or $CACHE_DIR) holds two entries per run —
  the instrumented source (keyed by source + flags) and the execution result
  (keyed by instrumented + stdin + flags). Lookups happen BEFORE the sandbox
  run; stores happen after SUCCESS only (compile errors are never cached).
  Every response carries ``X-Cache: HIT/MISS`` as an HTTP header — never
  inside the NDJSON event stream (stream shape untouched).

  No volume is mounted at the cache dir (compose mounts none, Dockerfile
  copies no volume), so sleep/restart wipes it: a cold-start MISS is expected
  and logged, never a failure. Persistent-volume variant is a follow-up note
  in cache.py, not implemented here. No DB anywhere (plain JSON files).

Streaming (compressed=true):
  - Response is application/x-ndjson (newline-delimited JSON).
  - Each trace event is yielded as it becomes available.
  - CFG + metadata is the final NDJSON line.
  - X-CFG: true header signals this is a streaming response.

Batch endpoint:
  POST /execute-batch — runs multiple test cases against the same code
  in parallel. Instruments once, compiles once, then fans out run-only
  to one sandbox per test.
  Concurrency is capped by $MAX_BATCH_SANDBOXES (default 4) for fan-out;
  pool saturation fails each case fast (runtime_error="saturated, retry").
"""

# NOTE: no `from __future__ import annotations` here on purpose. slowapi's
# @limiter.limit wraps endpoints via functools.wraps, so FastAPI resolves
# string annotations in slowapi's namespace — ExecuteRequest would vanish
# and the body would parse as a query param (422). Real annotations avoid it.

import asyncio
import json
import logging
import os
import secrets
import tempfile
import threading
import time
from collections.abc import AsyncGenerator, Awaitable, Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import TypeVar

import docker.errors
from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.encoders import jsonable_encoder
from fastapi.responses import ORJSONResponse, StreamingResponse

from app.core.budget import consume_budget
from app.core.executor.cache import (
    TOOLCHAIN_FLAGS,
    SharedCache,
    instrumenter_version,
    result_key,
    source_key,
)
from app.core.executor.docker_runner import RunResult, _apply_output_guard, run_in_sandbox
from app.core.executor.sandbox_config import MAX_TRACE_LINES
from app.core.executor.subprocess_runner import compile_source_sync
from app.core.instrumenter.injector import instrument
from app.core.rate_limit import EXECUTE_BATCH_LIMIT, EXECUTE_LIMIT, limiter
from app.core.stdin.parser import parse_stdin
from app.core.trace.cfg_builder import build as build_cfg
from app.core.trace.parser import parse as parse_trace
from app.models.request import ExecuteBatchRequest, ExecuteRequest
from app.models.response import ExecuteBatchResponseItem, ExecuteResponse

logger = logging.getLogger(__name__)

# ── Single-execute router ─────────────────────────────────────────────────
router = APIRouter()

# ── Batch-execute router ──────────────────────────────────────────────────
batch_router = APIRouter()

_TESTCASE_DIR = Path("/tmp/algo-theseus/testcases")
_BATCH_PER_CASE_TIMEOUT = 10  # seconds per test case


# ── Disk-cache plumbing (task 22) ─────────────────────────────────────────


_cache: SharedCache | None = None
_miss_logged = False


def get_cache() -> SharedCache:
    """Process-wide two-tier cache singleton (L1 Redis + L2 disk, env-built)."""
    global _cache
    if _cache is None:
        _cache = SharedCache.from_env()
    return _cache


def reset_cache() -> None:
    """Drop the singleton (tests re-point CACHE_DIR per case)."""
    global _cache, _miss_logged
    _cache = None
    _miss_logged = False
    _inflight_reset()
    reset_sandbox_pool()


# ── Sandbox concurrency pool (Wave5 3.1) ────────────────────────────────────
# Process-wide asyncio.Semaphore caps concurrent sandbox runs at
# GLOBAL_SANDBOX_MAX (env SANDBOX_MAX_CONCURRENT, default 6). EVERY
# run_in_sandbox call — single _resolve and batch _run_one, hence the worker
# too (it reuses _resolve) — goes through _run_sandbox_guarded. Cache hits
# and singleflight waiters never touch the semaphore: only the leader's real
# sandbox run acquires it. Wave6 3.2: acquisition is non-blocking try-acquire
# (fail-fast 429 / per-case saturated item, never queued); batch fan-out
# (MAX_BATCH_SANDBOXES=4) nests INSIDE the pool (batch outer, pool inner —
# consistent order, no deadlock).

GLOBAL_SANDBOX_MAX = 6

_sandbox_sem: asyncio.Semaphore | None = None
_sandbox_sem_size: int | None = None


def sandbox_max() -> int:
    """Pool size from $SANDBOX_MAX_CONCURRENT (default GLOBAL_SANDBOX_MAX)."""
    try:
        return max(1, int(os.getenv("SANDBOX_MAX_CONCURRENT", str(GLOBAL_SANDBOX_MAX))))
    except ValueError:
        logger.warning("Bad SANDBOX_MAX_CONCURRENT — falling back to %d", GLOBAL_SANDBOX_MAX)
        return GLOBAL_SANDBOX_MAX


def get_sandbox_sem() -> asyncio.Semaphore:
    """Process-wide pool singleton (rebuilt when the env size changes)."""
    global _sandbox_sem, _sandbox_sem_size
    want = sandbox_max()
    if _sandbox_sem is None or _sandbox_sem_size != want:
        _sandbox_sem = asyncio.Semaphore(want)
        _sandbox_sem_size = want
    return _sandbox_sem


def reset_sandbox_pool() -> None:
    """Drop the pool singleton (tests re-point SANDBOX_MAX_CONCURRENT)."""
    global _sandbox_sem, _sandbox_sem_size
    _sandbox_sem = None
    _sandbox_sem_size = None


# ── Sandbox backpressure (Wave6 3.2, fail-fast 429; Fix 4 admission probe) ───
# POST /execute probes one pool slot WITHOUT waiting BEFORE any threadpool
# await: saturated → 429 {"detail": "sandbox saturated, retry"} + Retry-After
# 5 in microseconds (reachable even when the executor queues deep). The probe
# is a sensor, never held across awaits; the authoritative try-acquire stays
# in _run_sandbox_guarded. Under true saturation even cache hits and
# singleflight waiters shed at entry (retry will HIT) instead of queueing.
# Batch fan-out keeps its own queueing cap; only the pool try-acquires —
# saturated cases fail individually with runtime_error="saturated, retry".
# POST /jobs only enqueues (never touches the pool) → always 202.
# Distinct from slowapi's 429 ("Rate limit exceeded: …/minute"): different
# detail string, same integer Retry-After convention.

SATURATED_DETAIL = "sandbox saturated, retry"
SATURATED_RETRY_AFTER = "5"
BATCH_SATURATED_ERROR = "saturated, retry"
BATCH_EMPTY_STDIN_ERROR = "empty input: program reads stdin (cin/scanf) but this case has none"
INPUT_REQUIRED_DETAIL = (
    "No stdin provided but the program reads input (cin/scanf) — add input and run again"
)

# libclang AST stdin-read detection. Mirrors the frontend readsStdin
# heuristic in App.tsx (hint-only there) — keep the two in sync.
# Fail-open: only gates a clear 422, never silently alters runs.
# Unparseable code returns False so the instrumentation error speaks.
_STDIN_PLAIN_CALLS = frozenset({"scanf", "getchar", "getc"})


def _ast_callee_name(cursor) -> str:  # type: ignore[no-untyped-def]
    """Best-effort callee name for a call cursor (spelling or referenced)."""
    try:
        ref = cursor.referenced
        if ref is not None and ref.spelling:
            return ref.spelling
    except (AttributeError, TypeError, RuntimeError, ValueError):
        pass
    try:
        return cursor.spelling or ""
    except (AttributeError, TypeError, RuntimeError, ValueError):
        return ""


def _ast_kind_name(cursor) -> str:  # type: ignore[no-untyped-def]
    """Cursor kind name, '' when the bindings predate it (cf. ast_walker)."""
    try:
        return str(cursor.kind).split(".")[-1]
    except (AttributeError, ValueError):
        return ""


def _ast_subtree_refs(cursor, name: str) -> bool:  # type: ignore[no-untyped-def]
    """True when any DECL_REF_EXPR under *cursor* spells *name*."""
    stack = [cursor]
    while stack:
        cur = stack.pop()
        try:
            children = list(cur.get_children())
        except (AttributeError, TypeError, RuntimeError, ValueError):
            continue
        for child in children:
            if _ast_kind_name(child) == "DECL_REF_EXPR":
                try:
                    if child.spelling == name:
                        return True
                except (AttributeError, TypeError, RuntimeError, ValueError):
                    pass
            stack.append(child)
    return False


def _reads_stdin(code: str) -> bool:
    """True when *code* contains a real stdin read (libclang AST).

    Matches ``operator>>`` on ``std::cin``, ``scanf(``, ``getline(cin,``,
    ``getchar(``/``getc(`` call expressions. Comments and string literals
    never trigger (they are not code nodes). Unparseable code — or an
    unavailable libclang — returns False (fail open: the instrumentation
    error, not a missing-stdin 422, speaks for broken code).
    """
    try:
        import clang.cindex as clang

        from app.core.instrumenter import _libclang_compat
        from app.core.instrumenter.diagnostics import parse_with_diagnostics
    except Exception:  # noqa: BLE001 — stdin guard fail-open by design
        logger.warning("libclang unavailable — stdin guard fail-open")
        return False
    try:
        _libclang_compat.ensure_libclang()
        index = clang.Index.create()
        call_kinds = tuple(
            k
            for k in (
                clang.CursorKind.CALL_EXPR,
                getattr(clang.CursorKind, "CXX_OPERATOR_CALL_EXPR", None),
            )
            if k is not None
        )
    except Exception:  # noqa: BLE001 — libclang setup fail-open by design
        logger.warning("libclang setup failed — stdin guard fail-open")
        return False
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".cpp", delete=False, encoding="utf-8"
    ) as tmp:
        tmp.write(code)
        path = tmp.name
    try:
        try:
            tu = parse_with_diagnostics(index, path, _libclang_compat.default_extra_args())
        except Exception:  # noqa: BLE001 — unparseable input fail-open
            return False  # unparseable → fail open
        user_path = os.path.abspath(path)
        stack = [tu.cursor]
        while stack:
            cur = stack.pop()
            if cur is not tu.cursor:
                try:
                    loc = cur.location
                    if loc.file is not None and os.path.abspath(loc.file.name) != user_path:
                        continue  # header noise — prune the subtree
                except (AttributeError, TypeError, RuntimeError, ValueError, OSError):
                    pass
            kind = _ast_kind_name(cur)
            if kind in ("CALL_EXPR", "CXX_OPERATOR_CALL_EXPR") and cur.kind in call_kinds:
                callee = _ast_callee_name(cur)
                if callee in _STDIN_PLAIN_CALLS:
                    return True
                if callee in ("operator>>", "getline") and _ast_subtree_refs(cur, "cin"):
                    return True
            try:
                stack.extend(cur.get_children())
            except (AttributeError, TypeError, RuntimeError, ValueError):
                pass
        return False
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


class SandboxSaturatedError(RuntimeError):
    """Pool has no free slot right now (fail-fast, never queued)."""


def _try_acquire_slot(sem: asyncio.Semaphore) -> bool:
    """Non-blocking acquire: True + slot held on success, False otherwise.

    Check-then-decrement runs with no await in between, so it is atomic on
    the event loop (no other coroutine can interleave). A free slot with
    queued waiters also fails: jumping the FIFO queue would starve waiters.
    """
    try:
        value = sem._value
    except AttributeError:
        return not sem.locked()
    if value is not None and value <= 0:
        return False
    waiters = getattr(sem, "_waiters", None)
    if waiters is not None and len(waiters) > 0:
        return False
    if value is not None:
        sem._value = value - 1
        return True
    return not sem.locked()


async def _run_sandbox_guarded(instrumented: str, stdin_data: str) -> RunResult:
    """Run one sandbox, fail-fast when the process-wide pool is saturated."""
    sem = get_sandbox_sem()
    if not _try_acquire_slot(sem):
        raise SandboxSaturatedError(SATURATED_DETAIL)
    try:
        return await run_in_sandbox(instrumented, stdin_data)
    finally:
        sem.release()


async def _compile_shared_guarded(instrumented: str) -> tuple[bytes | None, str | None, bool]:
    """Compile once for a whole batch, fail-fast when the pool is saturated."""
    sem = get_sandbox_sem()
    if not _try_acquire_slot(sem):
        raise SandboxSaturatedError(SATURATED_DETAIL)
    try:
        return await asyncio.to_thread(compile_source_sync, instrumented)
    finally:
        sem.release()


async def _run_binary_guarded(
    instrumented: str, binary_bytes: bytes | None, stdin_data: str
) -> RunResult:
    """Run-phase-only sandbox run on a prebuilt binary, fail-fast on saturation."""
    sem = get_sandbox_sem()
    if not _try_acquire_slot(sem):
        raise SandboxSaturatedError(SATURATED_DETAIL)
    try:
        return await run_in_sandbox(instrumented, stdin_data, binary_bytes=binary_bytes)
    finally:
        sem.release()


def _probe_pool_or_raise() -> None:
    """Admission probe: shed load BEFORE any threadpool work (Fix 4).

    The authoritative acquire in ``_run_sandbox_guarded`` sits behind ~6
    sequential ``asyncio.to_thread`` hops (source-cache get, libclang
    instrument, source-cache put, result-cache get, stampede acquire/release)
    plus the sandbox run itself — all on the loop's small default executor.
    Under a unique-MISS storm that executor queues deep, so excess requests
    never REACH the guard in time: they pile until the client times out
    (60s waits, zero 429s) instead of failing fast.

    This probe is fully synchronous (no thread, no await), so it stays
    reachable under any threadpool pressure. A pass releases the probe
    immediately — it is a sensor, never held across cache/instrument awaits;
    the authoritative acquire stays in ``_run_sandbox_guarded`` (a probe-pass
    that loses the race still 429s there). A fail raises at entry: under true
    saturation even cache HITs / singleflight waiters shed here (fail-fast +
    Retry-After; the retry will HIT) instead of queueing behind the storm.
    """
    sem = get_sandbox_sem()
    if _try_acquire_slot(sem):
        sem.release()
        return
    raise SandboxSaturatedError(SATURATED_DETAIL)


# ── In-process singleflight (Wave4 2.3) ─────────────────────────────────────
# Process-wide map of in-flight sandbox runs, keyed by result_key (single) or
# the per-case result key (batch). Concurrent identical cold-cache requests
# coalesce onto one sandbox run; the leader's outcome — value or exception —
# is shared with all waiters. Waiters shield their wait: Task.cancel() on a
# waiter must never propagate into the shared future (asyncio cancels the
# future a task is suspended on). Entries are evicted in ``finally``.

T = TypeVar("T")

_inflight: dict[str, asyncio.Future] = {}
_inflight_guard = threading.Lock()


def _inflight_reset() -> None:
    with _inflight_guard:
        _inflight.clear()


async def _coalesced(key: str, factory: Callable[[], Awaitable[T]]) -> T:
    """Run ``factory`` once per key; concurrent callers share the outcome."""
    loop = asyncio.get_running_loop()
    with _inflight_guard:
        fut = _inflight.get(key)
        if fut is None:
            fut = loop.create_future()
            _inflight[key] = fut
            leader = True
        else:
            leader = False
    if not leader:
        return await asyncio.shield(fut)
    try:
        result = await factory()
    except BaseException as e:
        if not fut.done():
            fut.set_exception(e)
        raise
    else:
        if not fut.done():
            fut.set_result(result)
        return result
    finally:
        with _inflight_guard:
            if _inflight.get(key) is fut:
                del _inflight[key]


# ── Redis stampede lock (Wave6 3.3) ─────────────────────────────────────────
# Cross-instance singleflight: the in-process _coalesced map stops stampedes
# within ONE process; N processes/replicas each run their own leader. Before
# the sandbox run the leader tries ``SET theseus:lock:<result_key> <token>
# NX PX 15000`` on the shared-cache L1 client. The holder runs the sandbox
# and populates the shared cache; non-holders poll the shared cache for
# STAMPEDE_POLL_TIMEOUT (15s at 100ms) for a HIT. Poll timeout → run anyway
# (fail-open, bounded at ~2x for one slow holder). Release is holder-only
# via a Lua compare-del. No L1 / any Redis error → skip the lock entirely
# (fail-open: behave exactly like the pre-lock path). Never raises.

STAMPEDE_LOCK_PREFIX = "theseus:lock:"
STAMPEDE_LOCK_TTL_MS = 15000
STAMPEDE_POLL_TIMEOUT = 15.0
STAMPEDE_POLL_INTERVAL = 0.1
_STAMPEDE_RELEASE_LUA = (
    "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end"
)


def _stampede_lock_key(rkey: str) -> str:
    return f"{STAMPEDE_LOCK_PREFIX}{rkey}"


def _stampede_l1(cache: SharedCache):  # type: ignore[no-untyped-def]
    """Shared-cache L1 client, or None (no Redis → run without the lock)."""
    return getattr(cache, "_l1", None)


def _stampede_try_acquire(cache: SharedCache, rkey: str) -> tuple[str | None, bool]:
    """Try to become the stampede holder for ``rkey``.

    Returns ``(token, should_poll)``: ``(token, False)`` we hold the lock
    (``token`` releases it); ``(None, True)`` someone else holds it — poll
    the shared cache; ``(None, False)`` no L1 / Redis error — run directly
    (fail-open, never raises).
    """
    l1 = _stampede_l1(cache)
    if l1 is None:
        return None, False
    token = secrets.token_hex(16)
    try:
        held = l1.set(_stampede_lock_key(rkey), token, nx=True, px=STAMPEDE_LOCK_TTL_MS)
    except Exception:  # noqa: BLE001 — Redis error fail-open to direct run
        logger.warning("Stampede lock acquire failed — running without lock")
        return None, False
    if held:
        return token, False
    return None, True


def _stampede_release(cache: SharedCache, rkey: str, token: str | None) -> None:
    """Release the lock only if we still hold it (Lua compare-del). Never raises."""
    if token is None:
        return
    l1 = _stampede_l1(cache)
    if l1 is None:
        return
    lock_key = _stampede_lock_key(rkey)
    try:
        try:
            l1.eval(_STAMPEDE_RELEASE_LUA, 1, lock_key, token)
            return
        except Exception:  # noqa: BLE001, S110 — no-EVAL client, fallback below
            pass  # client without EVAL (dict fakes) → compare-del fallback
        try:
            raw = l1.get(lock_key)
        except Exception:  # noqa: BLE001 — cache read fail-open
            return
        if raw == token or raw == token.encode("utf-8"):
            try:
                l1.delete(lock_key)
            except Exception:  # noqa: BLE001, S110 — best-effort, TTL covers
                pass
    except Exception:  # noqa: BLE001 — release never raises, TTL covers
        logger.warning("Stampede lock release failed — TTL covers it")


async def _stampede_poll(cache: SharedCache, rkey: str) -> RunResult | None:
    """Poll the shared cache until the holder stores, or the window lapses."""
    deadline = time.monotonic() + STAMPEDE_POLL_TIMEOUT
    while time.monotonic() < deadline:
        await asyncio.sleep(STAMPEDE_POLL_INTERVAL)
        hit = await asyncio.to_thread(cache.get, rkey)
        if isinstance(hit, dict):
            return _payload_to_result(hit)
    return None


async def _sandbox_with_stampede_lock(
    cache: SharedCache, rkey: str, run_and_store: Callable[[], Awaitable[RunResult]]
) -> tuple[RunResult, bool]:
    """Run ``run_and_store`` under the cross-instance stampede lock.

    Returns ``(run_result, cache_hit)``: ``cache_hit`` is True only when
    served from the shared cache via poll (holder and timeout runs are MISS).
    """
    # No L1 (or nothing held): both calls are pure no-ops — skip the thread
    # hop so saturated-pool shedding never queues behind the executor.
    if _stampede_l1(cache) is None:
        token, should_poll = _stampede_try_acquire(cache, rkey)
    else:
        token, should_poll = await asyncio.to_thread(_stampede_try_acquire, cache, rkey)
    if should_poll:
        polled = await _stampede_poll(cache, rkey)
        if polled is not None:
            return polled, True
        logger.warning("Stampede poll timed out for %s — running anyway", rkey[:12])
    try:
        return await run_and_store(), False
    finally:
        if token is not None:
            await asyncio.to_thread(_stampede_release, cache, rkey, token)


def _flags_for(kind: str) -> dict:
    """Flag set baked into every cache key.

    ``kind`` separates single vs batch entries; toolchain + MAX_TRACE_LINES pin
    the sandbox behaviour. A different flag set is ALWAYS a different key —
    entries are never shared across flags.

    ``compressed`` is DELIBERATELY absent: it is a read-time projection
    (``parse(raw, compressed=...)`` over the stored ``trace_raw``), not a
    run-time property, so both modes share one result entry and the parse
    runs per request.
    """
    return {
        "kind": kind,
        "toolchain": TOOLCHAIN_FLAGS,
        "max_trace_lines": MAX_TRACE_LINES,
        "instrumenter": instrumenter_version(),
    }


def _result_to_payload(r: RunResult) -> dict:
    return {
        "stdout": r.stdout,
        "stderr_clean": r.stderr_clean,
        "trace_raw": r.trace_raw,
        "exit_code": r.exit_code,
        "timed_out": r.timed_out,
        "truncated": r.truncated,
    }


def _payload_to_result(p: dict) -> RunResult:
    result = RunResult(
        stdout=p.get("stdout", ""),
        stderr_clean=p.get("stderr_clean", ""),
        trace_raw=list(p.get("trace_raw", [])),
        exit_code=int(p.get("exit_code", 0)),
        timed_out=bool(p.get("timed_out", False)),
        truncated=bool(p.get("truncated", False)),
    )
    stderr_clean, truncated = _apply_output_guard(
        result.exit_code, result.stderr_clean, result.truncated
    )
    result.stderr_clean = stderr_clean
    result.truncated = truncated
    return result


def _log_cold_miss_once() -> None:
    global _miss_logged
    if not _miss_logged:
        _miss_logged = True
        logger.info(
            "Cache MISS (cold start is expected: /tmp is wiped on sleep/restart, "
            "no volume mounted — serving from sandbox)"
        )


@dataclass
class _Resolved:
    """Outcome of the shared pre-sandbox pipeline (stdin → instrument → cache/sandbox)."""

    cleaned_stdin: str = ""
    instrumented: str | None = None
    trace_call_count: int = 0
    run_result: RunResult | None = None
    cache_hit: bool = False
    warnings: list = field(default_factory=list)
    input_error: str | None = None
    instrumentation_error: str | None = None
    sandbox_error: str | None = None


async def _resolve(req: ExecuteRequest, kind: str) -> _Resolved:
    """Run everything up to (and including) the sandbox, using the disk cache.

    Lookup order: instrumented-source entry first (skips libclang on hit),
    then execution-result entry (skips the sandbox on hit). Stores happen
    after success only — compile errors and sandbox exceptions are never
    cached.

    Admission (Fix 4): the pool probe runs FIRST, before any threadpool
    await — saturated → SandboxSaturatedError (429) in microseconds.
    """
    _probe_pool_or_raise()
    flags = _flags_for(kind)
    cache = get_cache()

    # ── Step 1: Parse stdin ───────────────────────────────────────────────
    cleaned_stdin, _ = await parse_stdin(req.code, req.raw_stdin)

    # Fail fast: reads from empty stdin leave variables uninitialized, so the
    # program loops on garbage until the sandbox kills it (seconds wasted,
    # cryptic timeout). Never burn a sandbox slot on this shape.
    if not cleaned_stdin.strip() and await asyncio.to_thread(_reads_stdin, req.code):
        return _Resolved(cleaned_stdin=cleaned_stdin, input_error=INPUT_REQUIRED_DETAIL)

    # ── Step 2: Instrument (or reuse the cached instrumented source) ──────
    skey = source_key(req.code, flags)
    sentry = await asyncio.to_thread(cache.get, skey)
    if isinstance(sentry, dict) and isinstance(sentry.get("instrumented"), str):
        instrumented = sentry["instrumented"]
        raw_warnings = sentry.get("warnings", [])
        warnings = list(raw_warnings) if isinstance(raw_warnings, list) else []
    else:
        warnings = []
        try:
            instrumented = await asyncio.to_thread(instrument, req.code, None, warnings)
        except (RuntimeError, ValueError, OSError) as e:
            return _Resolved(cleaned_stdin=cleaned_stdin, instrumentation_error=str(e))
        await asyncio.to_thread(
            cache.put, skey, {"instrumented": instrumented, "warnings": warnings}
        )

    trace_call_count = instrumented.count("__TRACE_")
    if trace_call_count == 0:
        logger.warning("Instrumentation produced zero trace calls")

    # ── Step 3: Execution result — singleflight around cache + sandbox ──────
    # The leader double-checks the cache inside the flight (a finished flight
    # may have stored while we queued); waiters share the leader's outcome.
    # Mode-independent: flags carry no ``compressed``, so this rkey (cache key
    # AND singleflight key) is shared by both parse modes — one cold pipeline
    # serves JSON and NDJSON clients; parse(raw, compressed=...) runs per request.
    rkey = result_key(instrumented, cleaned_stdin, flags)

    async def _load() -> tuple[RunResult, bool]:
        hit = await asyncio.to_thread(cache.get, rkey)
        if isinstance(hit, dict):
            return _payload_to_result(hit), True
        _log_cold_miss_once()

        async def _run_and_store() -> RunResult:
            run_result = await _run_sandbox_guarded(instrumented, cleaned_stdin)
            if run_result.compile_error is None:
                await asyncio.to_thread(cache.put, rkey, _result_to_payload(run_result))
            return run_result

        return await _sandbox_with_stampede_lock(cache, rkey, _run_and_store)

    try:
        run_result, cache_hit = await _coalesced(rkey, _load)
    except SandboxSaturatedError:
        raise
    except (RuntimeError, OSError, docker.errors.DockerException) as e:
        return _Resolved(
            cleaned_stdin=cleaned_stdin,
            instrumented=instrumented,
            trace_call_count=trace_call_count,
            warnings=warnings,
            sandbox_error=str(e),
        )
    return _Resolved(
        cleaned_stdin=cleaned_stdin,
        instrumented=instrumented,
        trace_call_count=trace_call_count,
        warnings=warnings,
        run_result=run_result,
        cache_hit=cache_hit,
    )


def _cache_header(hit: bool) -> dict[str, str]:
    return {"X-Cache": "HIT" if hit else "MISS"}


# ── Streaming NDJSON generator ───────────────────────────────────────────────


async def _stream_resolved(resolved: _Resolved) -> AsyncGenerator[bytes, None]:
    """Yield NDJSON lines for a pre-resolved execution.

    NDJSON format (each line is a complete JSON object):
      {"type":"event","data":{...}}   — one per trace event
      {"type":"cfg", ...}             — final line with CFG + metadata
      {"type":"error", ...}           — error line (compile/runtime)

    The response carries ``X-CFG: true`` and ``Content-Type: application/x-ndjson``.
    """
    if resolved.input_error is not None:
        payload = json.dumps(
            {"type": "error", "runtime_error": f"Missing stdin: {resolved.input_error}"}
        )
        yield (payload + "\n").encode()
        return

    if resolved.instrumentation_error is not None:
        payload = json.dumps(
            {
                "type": "error",
                "compile_error": f"Instrumentation error: {resolved.instrumentation_error}",
            }
        )
        yield (payload + "\n").encode()
        return

    if resolved.sandbox_error is not None:
        logger.exception("Sandbox execution failed")
        payload = json.dumps(
            {
                "type": "error",
                "runtime_error": f"Sandbox error: {resolved.sandbox_error}",
            }
        )
        yield (payload + "\n").encode()
        return

    assert resolved.run_result is not None
    run_result = resolved.run_result

    # Compile error — yield early
    if run_result.compile_error:
        payload = json.dumps({"type": "error", "compile_error": run_result.compile_error})
        yield (payload + "\n").encode()
        return

    # ── Parse trace (streaming path always parses compressed — adaptive
    #    stdout granularity from todo 10 applies inside the parser) ──────────
    events = await asyncio.to_thread(parse_trace, run_result.trace_raw, compressed=True)

    # Debug dumps for local diagnosis
    try:
        Path("/tmp/dsa_last_trace_raw.txt").write_text(
            "\n".join(run_result.trace_raw), encoding="utf-8"
        )
    except Exception:
        logger.debug("Failed to write trace debug file", exc_info=True)

    # ── Yield each event as an NDJSON line ────────────────────────────────────
    for event in events:
        event_data = event.model_dump(by_alias=False)
        payload = json.dumps({"type": "event", "data": event_data})
        yield (payload + "\n").encode()

    # ── Build CFG ─────────────────────────────────────────────────────
    cfg_nodes, cfg_edges = await asyncio.to_thread(build_cfg, events)

    # Determine runtime error
    runtime_error: str | None = None
    if run_result.timed_out:
        runtime_error = "Execution timed out (10s limit)"
    elif run_result.exit_code != 0 and run_result.stderr_clean:
        runtime_error = run_result.stderr_clean
    elif not events and resolved.trace_call_count == 0:
        runtime_error = (
            "No trace points were injected — check libclang parsing and instrumentation rules"
        )

    # ── Yield CFG as final NDJSON line ────────────────────────────────────────
    cfg_payload = json.dumps(
        {
            "type": "cfg",
            "stdout": run_result.stdout,
            "runtime_error": runtime_error,
            "timed_out": run_result.timed_out,
            "truncated": run_result.truncated,
            "warnings": resolved.warnings,
            "cfg_nodes": [n.model_dump() for n in cfg_nodes],
            "cfg_edges": [e.model_dump() for e in cfg_edges],
            "total_steps": len(events),
        }
    )
    yield (cfg_payload + "\n").encode()


# ── Single-execute endpoint ────────────────────────────────────────────────────


# Route decorator stays ABOVE the limit decorator (slowapi requirement).
# The limit runs inside the endpoint call, i.e. AFTER body validation —
# a 422 consumes no quota. /execute-batch counts per-request here; todo 22's
# per-case sandbox semaphore still caps fan-out inside the handler.
@router.post("", response_model=ExecuteResponse)
@limiter.limit(EXECUTE_LIMIT)
async def execute(
    request: Request, response: Response, req: ExecuteRequest
) -> ExecuteResponse | StreamingResponse | ORJSONResponse:
    """Instrument, run, and trace a C++ program.

    Steps:
      1. Parse raw stdin into clean input.
      2. Instrument source with libclang injector (cached by source + flags).
      3. Run in Docker sandbox with cleaned stdin (cached by instrumented + stdin + flags).
      4. Parse trace output.
      5. Build CFG.
      6. Return structured response (JSON or NDJSON streaming).

    When ``compressed=True`` the response is a StreamingResponse with
    ``Content-Type: application/x-ndjson``.  Each trace event is yielded
    as it becomes available.  The final line contains the CFG + metadata.

    When ``compressed=False`` (default) the full JSON response is returned
    in one shot — existing non-streaming behaviour.

    Both paths carry ``X-Cache: HIT/MISS`` on the HTTP response headers.

    Returns compile_error if compilation fails (trace will be empty).
    Returns runtime_error if the program crashes or times out.
    """
    await consume_budget(1)  # free-tier hard cap: 503 past the monthly/daily budget
    try:
        resolved = await _resolve(req, kind="single")
    except SandboxSaturatedError:
        raise HTTPException(
            status_code=429,
            detail=SATURATED_DETAIL,
            headers={"Retry-After": SATURATED_RETRY_AFTER},
        )

    # ── Streaming path ────────────────────────────────────────────────────────
    if req.compressed:
        return StreamingResponse(
            _stream_resolved(resolved),
            media_type="application/x-ndjson",
            headers={"X-CFG": "true", **_cache_header(resolved.cache_hit)},
        )

    # ── Non-streaming path (existing behaviour) ──────────────────────────────

    if resolved.input_error is not None:
        raise HTTPException(status_code=422, detail=f"Missing stdin: {resolved.input_error}")
    if resolved.instrumentation_error is not None:
        logger.exception("Instrumentation failed")
        raise HTTPException(
            status_code=422,
            detail=f"Instrumentation error: {resolved.instrumentation_error}",
        )
    if resolved.sandbox_error is not None:
        logger.exception("Sandbox execution failed")
        raise HTTPException(status_code=500, detail=f"Sandbox error: {resolved.sandbox_error}")

    assert resolved.run_result is not None
    run_result = resolved.run_result
    headers = _cache_header(resolved.cache_hit)

    # Debug dumps for local diagnosis
    if resolved.instrumented is not None:
        try:
            Path("/tmp/dsa_last_instrumented.cpp").write_text(
                resolved.instrumented, encoding="utf-8"
            )
        except Exception:
            logger.debug("Failed to write instrumented debug file", exc_info=True)

    # Compile error — return early with the error message
    if run_result.compile_error:
        return ORJSONResponse(
            content=jsonable_encoder(
                ExecuteResponse(stdout="", compile_error=run_result.compile_error)
            ),
            headers=headers,
        )

    # Parse trace (adaptive stdout granularity from todo 10 applies inside
    # the parser when compressed=True; JSON default keeps full granularity)
    events = await asyncio.to_thread(parse_trace, run_result.trace_raw, compressed=req.compressed)

    try:
        Path("/tmp/dsa_last_trace_raw.txt").write_text(
            "\n".join(run_result.trace_raw), encoding="utf-8"
        )
    except Exception:
        logger.debug("Failed to write trace debug file", exc_info=True)

    # Build CFG
    cfg_nodes, cfg_edges = await asyncio.to_thread(build_cfg, events)

    # Determine runtime error
    runtime_error: str | None = None
    if run_result.timed_out:
        runtime_error = "Execution timed out (10s limit)"
    elif run_result.exit_code != 0 and run_result.stderr_clean:
        runtime_error = run_result.stderr_clean
    elif not events and resolved.trace_call_count == 0:
        runtime_error = (
            "No trace points were injected — check libclang parsing and instrumentation rules"
        )

    return ORJSONResponse(
        content=jsonable_encoder(
            ExecuteResponse(
                stdout=run_result.stdout,
                runtime_error=runtime_error,
                timed_out=run_result.timed_out,
                truncated=run_result.truncated,
                warnings=resolved.warnings,
                trace=[e.model_dump(by_alias=False) for e in events],
                cfg_nodes=cfg_nodes,
                cfg_edges=cfg_edges,
                total_steps=len(events),
            ),
            # Wire contract: FULL names (encoder default by_alias=True re-emits SHORT aliases).
            by_alias=False,
        ),
        headers=headers,
    )


# ── Batch execution ──────────────────────────────────────────────────────────────────


def _batch_fanout_limit() -> int:
    """Max concurrent sandboxes for one /execute-batch (env, default 4)."""
    try:
        return max(1, int(os.getenv("MAX_BATCH_SANDBOXES", "4")))
    except ValueError:
        logger.warning("Bad MAX_BATCH_SANDBOXES — falling back to 4")
        return 4


@batch_router.post("", response_model=list[ExecuteBatchResponseItem], response_model_by_alias=False)
@limiter.limit(EXECUTE_BATCH_LIMIT)
async def execute_batch(
    request: Request, response: Response, req: ExecuteBatchRequest
) -> list[ExecuteBatchResponseItem]:
    """Run code against multiple test cases in parallel.

    Steps for each test case:
      1. Read input.txt from /tmp/algo-theseus/testcases/<test_id>/
      2. Instrument the source (done once, shared across all cases).
      3. Run the instrumented binary in a dedicated sandbox.
      4. Parse trace output and build CFG.

    Each test case gets its own 10s timeout via ``asyncio.wait_for``.
    Containers are never shared between test cases. Sandbox fan-out is
    capped (default 4 concurrent); the remainder queue on a semaphore.
    Pool saturation fails that case fast (runtime_error="saturated, retry").
    """
    # ── Read all test inputs upfront ──────────────────────────────────────────
    test_inputs: list[tuple[str, str]] = []
    for test_id in req.test_ids:
        input_file = _TESTCASE_DIR / test_id / "input.txt"
        if not input_file.is_file():
            raise HTTPException(
                status_code=404,
                detail=f"Test case '{test_id}' not found at {input_file}",
            )
        test_inputs.append((test_id, input_file.read_text(encoding="utf-8")))

    # Free-tier hard cap: one budget unit per case (conservative — the shared
    # compile makes cases cheaper than 1 unit, but never the reverse).
    await consume_budget(len(test_inputs))

    # ── Instrument once (same code, reused across all test cases) ─────────────
    batch_warnings: list[str] = []
    try:
        instrumented = await asyncio.to_thread(instrument, req.code, None, batch_warnings)
    except Exception as e:
        logger.exception("Instrumentation failed")
        raise HTTPException(status_code=422, detail=f"Instrumentation error: {e}")

    # Debug dump
    try:
        Path("/tmp/dsa_last_instrumented.cpp").write_text(instrumented, encoding="utf-8")
    except Exception:
        logger.debug("Failed to write instrumented debug file", exc_info=True)

    trace_call_count = instrumented.count("__TRACE_")
    if trace_call_count == 0:
        logger.warning("Instrumentation produced zero trace calls")

    # ── Compile once (subprocess mode): one g++ for the whole batch ─────────
    # Per-case runs below reuse these bytes (run phase only). Docker mode has
    # no host-side compile — binary stays None and each case runs full
    # compile+run exactly as before.
    binary: bytes | None = None
    if os.environ.get("SANDBOX_MODE", "docker").strip().lower() == "subprocess":
        try:
            binary, shared_compile_error, _ = await _compile_shared_guarded(instrumented)
        except SandboxSaturatedError:
            return [
                ExecuteBatchResponseItem(
                    test_id=test_id,
                    stdout="",
                    runtime_error=BATCH_SATURATED_ERROR,
                )
                for test_id, _ in test_inputs
            ]
        if shared_compile_error is not None:
            return [
                ExecuteBatchResponseItem(
                    test_id=test_id,
                    stdout="",
                    compile_error=shared_compile_error,
                )
                for test_id, _ in test_inputs
            ]

    # ── Fan-out cap: at most N sandboxes concurrently, remainder queue ───────
    semaphore = asyncio.Semaphore(_batch_fanout_limit())
    cache = get_cache()
    flags = _flags_for("batch")

    # ── Per-test-case runner ──────────────────────────────────────────────────
    async def _run_one(test_id: str, stdin_data: str) -> ExecuteBatchResponseItem:
        """Run the full pipeline for a single test case."""
        async with semaphore:
            if not stdin_data.strip() and await asyncio.to_thread(_reads_stdin, req.code):
                return ExecuteBatchResponseItem(
                    test_id=test_id,
                    stdout="",
                    runtime_error=BATCH_EMPTY_STDIN_ERROR,
                )
            key = result_key(instrumented, stdin_data, flags)

            async def _load() -> RunResult:
                cached = await asyncio.to_thread(cache.get, key)
                if isinstance(cached, dict):
                    return _payload_to_result(cached)

                async def _run_and_store() -> RunResult:
                    run_result = await asyncio.wait_for(
                        _run_binary_guarded(instrumented, binary, stdin_data),
                        timeout=_BATCH_PER_CASE_TIMEOUT,
                    )
                    if run_result.compile_error is None:
                        await asyncio.to_thread(
                            cache.put,
                            key,
                            _result_to_payload(run_result),
                        )
                    return run_result

                run_result, _hit = await _sandbox_with_stampede_lock(cache, key, _run_and_store)
                return run_result

            try:
                run_result = await _coalesced(key, _load)
            except SandboxSaturatedError:
                return ExecuteBatchResponseItem(
                    test_id=test_id,
                    stdout="",
                    runtime_error=BATCH_SATURATED_ERROR,
                )
            except TimeoutError:
                logger.warning("Test case %s timed out after %ds", test_id, _BATCH_PER_CASE_TIMEOUT)
                return ExecuteBatchResponseItem(
                    test_id=test_id,
                    stdout="",
                    runtime_error=f"Execution timed out ({_BATCH_PER_CASE_TIMEOUT}s limit)",
                    timed_out=True,
                )
            except Exception as e:
                logger.exception("Sandbox execution failed for test %s", test_id)
                return ExecuteBatchResponseItem(
                    test_id=test_id,
                    stdout="",
                    runtime_error=f"Sandbox error: {e}",
                )

        # Compile error — return early
        if run_result.compile_error:
            return ExecuteBatchResponseItem(
                test_id=test_id,
                stdout="",
                compile_error=run_result.compile_error,
            )

        # Parse trace and build CFG
        events = await asyncio.to_thread(parse_trace, run_result.trace_raw)
        cfg_nodes, cfg_edges = await asyncio.to_thread(build_cfg, events)

        # Determine runtime error
        runtime_error: str | None = None
        if run_result.timed_out:
            runtime_error = f"Execution timed out ({_BATCH_PER_CASE_TIMEOUT}s limit)"
        elif run_result.exit_code != 0 and run_result.stderr_clean:
            runtime_error = run_result.stderr_clean
        elif not events and trace_call_count == 0:
            runtime_error = (
                "No trace points were injected — check libclang parsing and instrumentation rules"
            )

        return ExecuteBatchResponseItem(
            test_id=test_id,
            stdout=run_result.stdout,
            runtime_error=runtime_error,
            timed_out=run_result.timed_out,
            truncated=run_result.truncated,
            warnings=list(batch_warnings),
            trace=[e.model_dump(by_alias=False) for e in events],
            cfg_nodes=cfg_nodes,
            cfg_edges=cfg_edges,
            total_steps=len(events),
        )

    # ── Fan out in parallel (capped by the semaphore) ─────────────────────────
    results = await asyncio.gather(*[_run_one(tid, inp) for tid, inp in test_inputs])
    return list(results)
