"""
core/rate_limit.py — Tiered per-IP rate limits (todo 23, slowapi defaults).

Limits: POST /execute 30/min/IP, POST /execute-batch 5/min/IP,
GET /health exempt. Exceeding a limit yields 429 + Retry-After via
slowapi's default handler.

Client key: first IP of X-Forwarded-For, trusted only when the header
carries at most TRUSTED_PROXY_COUNT (env, default 1) addresses — a longer
(spoofable) chain is distrusted and the direct peer IP is used instead.
Otherwise the direct client IP is the key.

Single-instance assumption: slowapi's default in-memory counters live in
this process only. Under replicas (or multi-worker uvicorn) each instance
counts independently, so the effective global limit multiplies by the
instance count and a client pinned to one replica sees a stricter limit
than a client spread across replicas. No Redis/DB by design (todo scope).

Counting order: slowapi's @limiter.limit decorates the endpoint function,
so FastAPI request-body validation runs FIRST — a 422 (e.g. empty body)
never reaches the decorator and consumes no quota.
"""

from __future__ import annotations

import logging
import os

from fastapi import Request
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


limiter = Limiter(key_func=client_key, headers_enabled=True, retry_after="integer")

EXECUTE_LIMIT = "30/minute"
EXECUTE_BATCH_LIMIT = "5/minute"
