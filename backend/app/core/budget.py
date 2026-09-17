"""core/budget.py — Monthly/daily free-tier execution budget (hard cap).

Every billable execution (/execute = 1, /execute-batch = N cases, /jobs = 1
at enqueue) INCRs shared Redis counters before touching the sandbox pool.
Past the cap the endpoint 503s with a reset date instead of spending money.

Sizing: the default 1.2M executions/month keeps every free-tier quota in
bounds with margin — requests (2M), RAM (360k GiB-s), and CPU even at 100%
cache-MISS (1.2M x 1.3s x 2 vCPU / 20-way packing = 156k of 180k vCPU-s).
Override via $MONTHLY_EXEC_LIMIT / $DAILY_EXEC_LIMIT.

Semantics mirror core/rate_limit.py: shared fixed-window counters via one
atomic Lua INCRBY + EXPIRE, month/day keys auto-roll (no reset job), and
fail-OPEN without Redis (a Redis outage must never become an outage).
"""

from __future__ import annotations

import logging
import os
import time

from fastapi import HTTPException

logger = logging.getLogger(__name__)

BUDGET_KEY_PREFIX = "theseus:budget:"
_MONTH_TTL_SECONDS = 32 * 86400  # key carries YYYY-MM; TTL is GC only
_DAY_TTL_SECONDS = 2 * 86400  # key carries YYYY-MM-DD; TTL is GC only

_BUDGET_LUA = (
    "local c = redis.call('INCRBY', KEYS[1], ARGV[2]) "
    "if c == tonumber(ARGV[2]) then redis.call('EXPIRE', KEYS[1], ARGV[1]) end "
    "return c"
)


def monthly_limit() -> int:
    try:
        return max(1, int(os.getenv("MONTHLY_EXEC_LIMIT", "1200000")))
    except ValueError:
        logger.warning("Bad MONTHLY_EXEC_LIMIT — falling back to 1200000")
        return 1200000


def daily_limit() -> int:
    try:
        return max(1, int(os.getenv("DAILY_EXEC_LIMIT", str(monthly_limit() // 31))))
    except ValueError:
        logger.warning("Bad DAILY_EXEC_LIMIT — falling back to monthly/31")
        return max(1, monthly_limit() // 31)


def _get_redis_client():  # type: ignore[no-untyped-def]
    """Pooled async Redis client, or None (seam for tests to override)."""
    from app.core import rate_limit as _rl

    try:
        return _rl._get_redis_client()
    except Exception:  # noqa: BLE001 — fail-open without Redis by design
        return None


def _month_reset() -> str:
    """First day of next month (YYYY-MM-DD) for the 503 message."""
    now = time.localtime()
    year, month = now.tm_year, now.tm_mon
    if month == 12:
        year, month = year + 1, 1
    else:
        month += 1
    return f"{year:04d}-{month:02d}-01"


async def _bump(client, key: str, ttl: int, n: int) -> int:
    return int(await client.eval(_BUDGET_LUA, 1, key, ttl, n))


async def consume_budget(n: int = 1) -> None:
    """Count n executions against the budget; 503 past either cap.

    Monthly is bumped first so a blown month doesn't also eat the daily
    window. Attempts consume (conservative: never undercounts). Fail-open
    without Redis — logged, never a 500.
    """
    client = _get_redis_client()
    if client is None:
        return
    now = time.localtime()
    month_key = f"{BUDGET_KEY_PREFIX}{now.tm_year:04d}-{now.tm_mon:02d}"
    day_key = f"{BUDGET_KEY_PREFIX}{now.tm_year:04d}-{now.tm_mon:02d}-{now.tm_mday:02d}"
    try:
        mcount = await _bump(client, month_key, _MONTH_TTL_SECONDS, n)
        if mcount > monthly_limit():
            raise HTTPException(
                status_code=503,
                detail=(
                    f"Monthly free-tier execution budget exhausted "
                    f"({monthly_limit()}/month) — resets {_month_reset()}"
                ),
            )
        dcount = await _bump(client, day_key, _DAY_TTL_SECONDS, n)
        if dcount > daily_limit():
            raise HTTPException(
                status_code=503,
                detail=(
                    f"Daily free-tier execution budget exhausted "
                    f"({daily_limit()}/day) — resets tomorrow (UTC)"
                ),
            )
    except HTTPException:
        raise
    except Exception:
        logger.warning("Budget Redis unavailable — fail-open", exc_info=True)


__all__ = ["BUDGET_KEY_PREFIX", "consume_budget", "daily_limit", "monthly_limit"]
