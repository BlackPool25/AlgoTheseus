"""
core/rate_limit.py — Tiered per-IP rate limits (todo 23, slowapi defaults).

Limits: POST /execute 30/min/IP, POST /execute-batch 5/min/IP,
POST /jobs 30/min/IP, GET /health exempt. Exceeding a limit yields
429 + Retry-After via slowapi's default handler (in-memory path) or a
429 + integer Retry-After via the distributed layer (Redis path).

Client key: first IP of X-Forwarded-For, trusted only when the header
carries at most TRUSTED_PROXY_COUNT (env, default 1) addresses — a longer
(spoofable) chain is distrusted and the direct peer IP is used instead.
Otherwise the direct client IP is the key.

Distributed counting (Wave2 1.2): a thin wrapper around the slowapi
``limiter`` adds one shared fixed-window check per request BEFORE slowapi's
own in-memory check. Counters are ``theseus:rl:<scope>:<key>:<minute>``
(``scope`` = execute/batch/jobs from the request path, ``minute`` =
unix-minute bucket), bumped atomically via Lua INCR + EXPIRE 60s over the
pooled Redis client from ``app.core.queue.backends`` (one client per URL,
shared process-wide). The global budget is therefore enforced across
replicas and uvicorn workers; slowapi's in-memory counters remain as the
local fallback.

Failure semantics: Redis unreachable/misconfigured -> fail OPEN to the
in-memory counters with a warning logged (never a 500). No REDIS_URL or no
``redis`` package -> the wrapper is a pure pass-through.

Counting order: the wrapper runs inside the endpoint call, i.e. AFTER
FastAPI body validation — a 422 (e.g. empty body) never reaches it and
consumes no quota. Route decorators are untouched (slowapi surface kept).
"""

from __future__ import annotations

import inspect
import logging
import os
import time
from collections.abc import Callable
from functools import wraps
from typing import Any

from fastapi import HTTPException, Request
from slowapi import Limiter

logger = logging.getLogger(__name__)


def _trusted_proxy_count() -> int:
    try:
        return max(0, int(os.getenv("TRUSTED_PROXY_COUNT", "1")))
    except ValueError:
        logger.warning("Bad TRUSTED_PROXY_COUNT — falling back to 1")
        return 1


def client_key(request: Request) -> str:
    """Rate-limit key: first XFF IP within the trusted-proxy budget."""
    direct = request.client.host if request.client else "unknown"
    trusted = _trusted_proxy_count()
    if trusted > 0:
        xff = request.headers.get("x-forwarded-for")
        if xff:
            ips = [p.strip() for p in xff.split(",") if p.strip()]
            if 1 <= len(ips) <= trusted:
                return ips[0]
            # More hops than we trust (spoofable prefix) → ignore the header.
    return direct


EXECUTE_LIMIT = "30/minute"
EXECUTE_BATCH_LIMIT = "5/minute"
JOBS_LIMIT = "30/minute"


def redis_limiter_available() -> bool:
    """True when a shared Redis limiter can be wired (REDIS_URL + lib).

    The distributed wrapper in this module uses it whenever available;
    otherwise it passes through to the single-instance slowapi counters.
    """
    if not os.getenv("REDIS_URL", "").strip():
        return False
    try:
        import redis  # noqa: F401
    except Exception:
        return False
    return True


# ── Distributed fixed-window layer (Wave2 1.2) ────────────────────────────

RL_KEY_PREFIX = "theseus:rl:"
RL_WINDOW_SECONDS = 60

# Atomic bump: INCR, arming a 60s TTL on first hit. Fixed calendar-minute
# buckets (key carries the minute), so no sliding state is needed.
_RL_LUA = (
    "local c = redis.call('INCR', KEYS[1]) "
    "if c == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end "
    "return c"
)


def _current_minute() -> int:
    """Unix-minute bucket for the fixed-window key (seam for tests)."""
    return int(time.time() // RL_WINDOW_SECONDS)


def _scope_for(path: str) -> str:
    """Bucket scope from the request path (batch first: prefix overlap)."""
    if path.startswith("/execute-batch"):
        return "batch"
    if path.startswith("/jobs"):
        return "jobs"
    return "execute"


def _quota_from(limit_value: Any) -> int | None:
    """Leading per-minute amount of a slowapi limit string (None = skip)."""
    if callable(limit_value):
        return None  # dynamic limits stay slowapi-only (fail-open here)
    try:
        return max(1, int(str(limit_value).split("/")[0].strip()))
    except (ValueError, TypeError, AttributeError):
        logger.warning("Unparseable limit %r — distributed check skipped", limit_value)
        return None


def _get_redis_client() -> Any | None:
    """Pooled async Redis client, or None (seam for tests to override)."""
    url = os.getenv("REDIS_URL", "").strip()
    if not url:
        return None
    try:
        from app.core.queue import backends as _backends
    except Exception:
        return None
    if _backends.aioredis is None:
        return None
    try:
        return _backends._get_client(url)
    except Exception:
        logger.warning("Rate-limit Redis pool unavailable — fail-open to in-memory")
        return None


def _find_request(args: tuple, kwargs: dict) -> Request | None:
    """Locate the FastAPI Request among endpoint args (slowapi-style scan)."""
    for value in list(args) + list(kwargs.values()):
        if isinstance(value, Request):
            return value
    return None


async def _check_distributed(request: Request, quota: int) -> None:
    """Shared fixed-window bump; raises 429 or fails open (never 500)."""
    client = _get_redis_client()
    if client is None:
        return
    try:
        rkey = (
            f"{RL_KEY_PREFIX}{_scope_for(request.url.path)}"
            f":{client_key(request)}:{_current_minute()}"
        )
        count = int(await client.eval(_RL_LUA, 1, rkey, RL_WINDOW_SECONDS))
        if count > quota:
            retry_after = max(
                1, RL_WINDOW_SECONDS - (int(time.time()) % RL_WINDOW_SECONDS)
            )
            raise HTTPException(
                status_code=429,
                detail=f"Rate limit exceeded: {quota}/minute",
                headers={"Retry-After": str(retry_after)},
            )
    except HTTPException:
        raise
    except Exception:
        logger.warning(
            "Rate-limit Redis unavailable — fail-open to in-memory counters",
            exc_info=True,
        )


class _DistributedLimiter:
    """slowapi Limiter + shared Redis fixed-window pre-check, same surface.

    ``limit()`` / ``exempt`` behave like slowapi's, so route decorators are
    untouched; everything else (``_storage``, ``_inject_headers``, ...) is
    proxied to the inner limiter (exception handler + test resets keep
    working). Sync endpoints skip the async Redis hop (slowapi still
    applies); async over-quota requests get 429 + integer Retry-After.
    """

    def __init__(self, inner: Limiter) -> None:
        self._inner = inner

    def limit(
        self, limit_value: Any, *args: Any, **kwargs: Any
    ) -> Callable[[Callable], Callable]:
        quota = _quota_from(limit_value)
        inner_deco = self._inner.limit(limit_value, *args, **kwargs)

        def decorator(func: Callable) -> Callable:
            wrapped = inner_deco(func)
            if quota is None or not inspect.iscoroutinefunction(func):
                return wrapped

            @wraps(func)
            async def _wrapper(*a: Any, **kw: Any) -> Any:
                request = _find_request(a, kw)
                if request is not None:
                    await _check_distributed(request, quota)
                return await wrapped(*a, **kw)

            return _wrapper

        return decorator

    def __getattr__(self, name: str) -> Any:
        return getattr(self.__dict__["_inner"], name)


limiter = _DistributedLimiter(
    Limiter(key_func=client_key, headers_enabled=True, retry_after="integer")
)
