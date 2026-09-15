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
  Disk LRU under /tmp/dsa-cache (or $CACHE_DIR) holds two entries per run —
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
  in parallel. Instruments once, then fans out to one sandbox per test.
  Concurrency is capped by $MAX_BATCH_SANDBOXES (default 4); the remainder
  queue on the semaphore — never rejected.
"""

# NOTE: no `from __future__ import annotations` here on purpose. slowapi's
# @limiter.limit wraps endpoints via functools.wraps, so FastAPI resolves
# string annotations in slowapi's namespace — ExecuteRequest would vanish
# and the body would parse as a query param (422). Real annotations avoid it.

import asyncio
import json
import logging
import os
from collections.abc import AsyncGenerator
from dataclasses import dataclass
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse, StreamingResponse

from app.core.executor.cache import (
    TOOLCHAIN_FLAGS,
    DiskLRUCache,
    result_key,
    source_key,
)
from app.core.executor.docker_runner import RunResult, run_in_sandbox
from app.core.executor.sandbox_config import MAX_TRACE_LINES
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

_TESTCASE_DIR = Path("/tmp/dsa-visualizer/testcases")
_BATCH_PER_CASE_TIMEOUT = 10  # seconds per test case


# ── Disk-cache plumbing (task 22) ─────────────────────────────────────────


_cache: DiskLRUCache | None = None
_miss_logged = False


def get_cache() -> DiskLRUCache:
    """Process-wide cache singleton (built from env on first use)."""
    global _cache
    if _cache is None:
        _cache = DiskLRUCache.from_env()
    return _cache


def reset_cache() -> None:
    """Drop the singleton (tests re-point CACHE_DIR per case)."""
    global _cache, _miss_logged
    _cache = None
    _miss_logged = False


def _flags_for(kind: str, compressed: bool) -> dict:
    """Flag set baked into every cache key.

    ``kind`` separates single vs batch entries; ``compressed`` separates the
    streaming parse mode from the JSON one; toolchain + MAX_TRACE_LINES pin
    the sandbox behaviour. A different flag set is ALWAYS a different key —
    entries are never shared across flags.
    """
    return {
        "kind": kind,
        "compressed": compressed,
        "toolchain": TOOLCHAIN_FLAGS,
        "max_trace_lines": MAX_TRACE_LINES,
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
    return RunResult(
        stdout=p.get("stdout", ""),
        stderr_clean=p.get("stderr_clean", ""),
        trace_raw=list(p.get("trace_raw", [])),
        exit_code=int(p.get("exit_code", 0)),
        timed_out=bool(p.get("timed_out", False)),
        truncated=bool(p.get("truncated", False)),
    )


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
    instrumentation_error: str | None = None
    sandbox_error: str | None = None


async def _resolve(req: ExecuteRequest, kind: str) -> _Resolved:
    """Run everything up to (and including) the sandbox, using the disk cache.

    Lookup order: instrumented-source entry first (skips libclang on hit),
    then execution-result entry (skips the sandbox on hit). Stores happen
    after success only — compile errors and sandbox exceptions are never
    cached.
    """
    flags = _flags_for(kind, req.compressed)
    cache = get_cache()

    # ── Step 1: Parse stdin ───────────────────────────────────────────────
    cleaned_stdin, _ = await parse_stdin(req.code, req.raw_stdin)

    # ── Step 2: Instrument (or reuse the cached instrumented source) ──────
    skey = source_key(req.code, flags)
    sentry = cache.get(skey)
    if isinstance(sentry, dict) and isinstance(sentry.get("instrumented"), str):
        instrumented = sentry["instrumented"]
    else:
        try:
            instrumented = instrument(req.code)
        except Exception as e:
            return _Resolved(
                cleaned_stdin=cleaned_stdin, instrumentation_error=str(e)
            )
        cache.put(skey, {"instrumented": instrumented})

    trace_call_count = instrumented.count("__TRACE_")
    if trace_call_count == 0:
        logger.warning("Instrumentation produced zero trace calls")

    # ── Step 3: Execution result from cache, else the sandbox ─────────────
    rkey = result_key(instrumented, cleaned_stdin, flags)
    hit = cache.get(rkey)
    if isinstance(hit, dict):
        return _Resolved(
            cleaned_stdin=cleaned_stdin,
            instrumented=instrumented,
            trace_call_count=trace_call_count,
            run_result=_payload_to_result(hit),
            cache_hit=True,
        )

    _log_cold_miss_once()
    try:
        run_result = await run_in_sandbox(instrumented, cleaned_stdin)
    except Exception as e:
        return _Resolved(
            cleaned_stdin=cleaned_stdin,
            instrumented=instrumented,
            trace_call_count=trace_call_count,
            sandbox_error=str(e),
        )
    if run_result.compile_error is None:
        cache.put(rkey, _result_to_payload(run_result))
    return _Resolved(
        cleaned_stdin=cleaned_stdin,
        instrumented=instrumented,
        trace_call_count=trace_call_count,
        run_result=run_result,
        cache_hit=False,
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
    if resolved.instrumentation_error is not None:
        payload = json.dumps(
            {"type": "error", "compile_error": f"Instrumentation error: {resolved.instrumentation_error}"}
        )
        yield (payload + "\n").encode()
        return

    if resolved.sandbox_error is not None:
        logger.exception("Sandbox execution failed")
        payload = json.dumps({"type": "error", "runtime_error": f"Sandbox error: {resolved.sandbox_error}"})
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
    events = parse_trace(run_result.trace_raw, compressed=True)

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
    cfg_nodes, cfg_edges = build_cfg(events)

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
    cfg_payload = json.dumps({
        "type": "cfg",
        "stdout": run_result.stdout,
        "runtime_error": runtime_error,
        "timed_out": run_result.timed_out,
        "truncated": run_result.truncated,
        "cfg_nodes": [n.model_dump() for n in cfg_nodes],
        "cfg_edges": [e.model_dump() for e in cfg_edges],
        "total_steps": len(events),
    })
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
) -> ExecuteResponse | StreamingResponse | JSONResponse:
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
    resolved = await _resolve(req, kind="single")

    # ── Streaming path ────────────────────────────────────────────────────────
    if req.compressed:
        return StreamingResponse(
            _stream_resolved(resolved),
            media_type="application/x-ndjson",
            headers={"X-CFG": "true", **_cache_header(resolved.cache_hit)},
        )

    # ── Non-streaming path (existing behaviour) ──────────────────────────────

    if resolved.instrumentation_error is not None:
        logger.exception("Instrumentation failed")
        raise HTTPException(
            status_code=422, detail=f"Instrumentation error: {resolved.instrumentation_error}"
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
        return JSONResponse(
            content=jsonable_encoder(
                ExecuteResponse(stdout="", compile_error=run_result.compile_error)
            ),
            headers=headers,
        )

    # Parse trace (adaptive stdout granularity from todo 10 applies inside
    # the parser when compressed=True; JSON default keeps full granularity)
    events = parse_trace(run_result.trace_raw, compressed=req.compressed)

    try:
        Path("/tmp/dsa_last_trace_raw.txt").write_text(
            "\n".join(run_result.trace_raw), encoding="utf-8"
        )
    except Exception:
        logger.debug("Failed to write trace debug file", exc_info=True)

    # Build CFG
    cfg_nodes, cfg_edges = build_cfg(events)

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

    return JSONResponse(
        content=jsonable_encoder(
            ExecuteResponse(
                stdout=run_result.stdout,
                runtime_error=runtime_error,
                timed_out=run_result.timed_out,
                truncated=run_result.truncated,
                trace=[e.model_dump(by_alias=False) for e in events],
                cfg_nodes=cfg_nodes,
                cfg_edges=cfg_edges,
                total_steps=len(events),
            )
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


@batch_router.post("", response_model=list[ExecuteBatchResponseItem])
@limiter.limit(EXECUTE_BATCH_LIMIT)
async def execute_batch(
    request: Request, response: Response, req: ExecuteBatchRequest
) -> list[ExecuteBatchResponseItem]:
    """Run code against multiple test cases in parallel.

    Steps for each test case:
      1. Read input.txt from /tmp/dsa-visualizer/testcases/<test_id>/
      2. Instrument the source (done once, shared across all cases).
      3. Run the instrumented binary in a dedicated sandbox.
      4. Parse trace output and build CFG.

    Each test case gets its own 10s timeout via ``asyncio.wait_for``.
    Containers are never shared between test cases. Sandbox fan-out is
    capped (default 4 concurrent); the remainder queue on a semaphore.
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

    # ── Instrument once (same code, reused across all test cases) ─────────────
    try:
        instrumented = instrument(req.code)
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

    # ── Fan-out cap: at most N sandboxes concurrently, remainder queue ───────
    semaphore = asyncio.Semaphore(_batch_fanout_limit())
    cache = get_cache()
    flags = _flags_for("batch", False)

    # ── Per-test-case runner ──────────────────────────────────────────────────
    async def _run_one(test_id: str, stdin_data: str) -> ExecuteBatchResponseItem:
        """Run the full pipeline for a single test case."""
        async with semaphore:
            try:
                cached = cache.get(result_key(instrumented, stdin_data, flags))
                if isinstance(cached, dict):
                    run_result = _payload_to_result(cached)
                else:
                    run_result = await asyncio.wait_for(
                        run_in_sandbox(instrumented, stdin_data),
                        timeout=_BATCH_PER_CASE_TIMEOUT,
                    )
                    if run_result.compile_error is None:
                        cache.put(result_key(instrumented, stdin_data, flags),
                                  _result_to_payload(run_result))
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
        events = parse_trace(run_result.trace_raw)
        cfg_nodes, cfg_edges = build_cfg(events)

        # Determine runtime error
        runtime_error: str | None = None
        if run_result.timed_out:
            runtime_error = f"Execution timed out ({_BATCH_PER_CASE_TIMEOUT}s limit)"
        elif run_result.exit_code != 0 and run_result.stderr_clean:
            runtime_error = run_result.stderr_clean
        elif not events and trace_call_count == 0:
            runtime_error = "No trace points were injected — check libclang parsing and instrumentation rules"

        return ExecuteBatchResponseItem(
            test_id=test_id,
            stdout=run_result.stdout,
            runtime_error=runtime_error,
            timed_out=run_result.timed_out,
            truncated=run_result.truncated,
            trace=[e.model_dump(by_alias=False) for e in events],
            cfg_nodes=cfg_nodes,
            cfg_edges=cfg_edges,
            total_steps=len(events),
        )

    # ── Fan out in parallel (capped by the semaphore) ─────────────────────────
    results = await asyncio.gather(*[_run_one(tid, inp) for tid, inp in test_inputs])
    return list(results)
