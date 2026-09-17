"""app/core/queue/backends.py — Queue + result-store backends.

Redis layout (when available):
  - pending list ``theseus:jobs:pending`` (LPUSH / BRPOP).
  - result keys ``theseus:job:<id>`` (SETEX, TTL 1h).

In-memory fallback: an ``asyncio.Queue`` plus a dict of records with
TTL enforced lazily on read. Used when REDIS_URL is unset, the redis
package is missing, or Redis is unreachable — never raises at import.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
import uuid

logger = logging.getLogger(__name__)

PENDING_KEY = "theseus:jobs:pending"
RESULT_KEY_PREFIX = "theseus:job:"
RESULT_TTL_SECONDS = 3600  # 1h

try:  # Optional dependency — never crash when redis is missing.
    from redis import asyncio as aioredis  # type: ignore[import-not-found]
except Exception:  # noqa: BLE001 — optional dep fallback, pragma: no cover
    aioredis = None  # type: ignore[assignment]

# Process-wide pooled async clients, one per Redis URL. redis.asyncio
# clients own a connection pool internally, so sharing one client per URL
# bounds total connections (max_connections=50) instead of opening +
# closing a connection per queue operation.
POOLED_MAX_CONNECTIONS = 50
_pooled: dict[str, object] = {}


def _get_client(url: str):  # type: ignore[no-untyped-def]
    """Return the shared pooled client for a URL, creating it on first use."""
    assert aioredis is not None
    client = _pooled.get(url)
    if client is None:
        client = aioredis.from_url(
            url,
            decode_responses=True,
            max_connections=POOLED_MAX_CONNECTIONS,
            socket_connect_timeout=2,
            socket_keepalive=True,
            health_check_interval=30,
        )
        _pooled[url] = client
    return client


async def reset_pool() -> None:
    """Close and drop all pooled clients (tests / shutdown)."""
    while _pooled:
        _, client = _pooled.popitem()
        try:
            await client.aclose()  # type: ignore[union-attr]
        except Exception:
            logger.warning("Error closing pooled redis client", exc_info=True)


def _job_key(job_id: str) -> str:
    """Redis key for a single job record."""
    return f"{RESULT_KEY_PREFIX}{job_id}"


class InMemoryQueue:
    """Process-local queue + store. Works with no external services."""

    def __init__(self) -> None:
        """Create an empty queue and record store."""
        self._pending: asyncio.Queue[str] = asyncio.Queue()
        self._records: dict[str, dict] = {}

    async def enqueue(self, payload: dict) -> str:
        """Store a new queued record and push its id. Returns the job id."""
        job_id = uuid.uuid4().hex
        now = time.time()
        self._records[job_id] = {
            "job_id": job_id,
            "status": "queued",
            "payload": payload,
            "result": None,
            "error": None,
            "created": now,
            "updated": now,
        }
        await self._pending.put(job_id)
        return job_id

    async def dequeue(self, timeout: float = 1.0) -> tuple[str, dict] | None:
        """Pop the next job id + payload, or None on timeout."""
        try:
            job_id = await asyncio.wait_for(self._pending.get(), timeout)
        except TimeoutError:
            return None
        rec = self._records.get(job_id)
        if rec is None:
            return None
        return job_id, rec["payload"]

    def _live(self, job_id: str) -> dict | None:
        """Return the record unless it expired (TTL enforced on read)."""
        rec = self._records.get(job_id)
        if rec is None:
            return None
        if time.time() - float(rec.get("created", 0)) > RESULT_TTL_SECONDS:
            self._records.pop(job_id, None)
            return None
        return rec

    async def get(self, job_id: str) -> dict | None:
        """Fetch a job record by id (None when unknown/expired)."""
        return self._live(job_id)

    async def set_status(
        self,
        job_id: str,
        status: str,
        result: dict | None = None,
        error: str | None = None,
    ) -> None:
        """Update status/result/error on an existing record (no-op if gone)."""
        rec = self._live(job_id)
        if rec is None:
            return
        rec["status"] = status
        rec["result"] = result
        rec["error"] = error
        rec["updated"] = time.time()


class RedisQueue:
    """Redis list-based queue with SETEX result records (TTL 1h)."""

    def __init__(self, url: str) -> None:
        """Bind to a Redis URL (pooled client shared process-wide per URL)."""
        self._url = url

    def _client(self):  # type: ignore[no-untyped-def]
        """Return the process-wide pooled async Redis client."""
        return _get_client(self._url)

    async def enqueue(self, payload: dict) -> str:
        """Persist a queued record and push its id. Returns the job id."""
        job_id = uuid.uuid4().hex
        now = time.time()
        rec = {
            "job_id": job_id,
            "status": "queued",
            "payload": payload,
            "result": None,
            "error": None,
            "created": now,
            "updated": now,
        }
        client = self._client()
        await client.setex(_job_key(job_id), RESULT_TTL_SECONDS, json.dumps(rec))
        await client.lpush(PENDING_KEY, job_id)
        return job_id

    async def dequeue(self, timeout: float = 1.0) -> tuple[str, dict] | None:
        """BRPOP the next job id and return id + payload (None on timeout)."""
        client = self._client()
        item = await client.brpop(PENDING_KEY, timeout=max(1, int(timeout)))
        if not item:
            return None
        _, job_id = item
        raw = await client.get(_job_key(job_id))
        if raw is None:
            return None
        rec = json.loads(raw)
        return str(job_id), rec["payload"]

    async def get(self, job_id: str) -> dict | None:
        """Fetch a job record by id (None when unknown/expired)."""
        raw = await self._client().get(_job_key(job_id))
        return json.loads(raw) if raw is not None else None

    async def set_status(
        self,
        job_id: str,
        status: str,
        result: dict | None = None,
        error: str | None = None,
    ) -> None:
        """Update status/result/error, refreshing the 1h TTL. No-op if gone."""
        client = self._client()
        raw = await client.get(_job_key(job_id))
        if raw is None:
            return
        rec = json.loads(raw)
        rec.update(
            {
                "status": status,
                "result": result,
                "error": error,
                "updated": time.time(),
            }
        )
        await client.setex(_job_key(job_id), RESULT_TTL_SECONDS, json.dumps(rec))


_queue: InMemoryQueue | RedisQueue | None = None


def get_queue() -> InMemoryQueue | RedisQueue:
    """Return the process-wide queue (Redis when usable, else in-memory)."""
    global _queue
    if _queue is not None:
        return _queue
    url = os.getenv("REDIS_URL", "").strip()
    if url and aioredis is not None:
        _queue = RedisQueue(url)
        logger.info("Job queue: redis backend")
    else:
        if url and aioredis is None:
            logger.warning("REDIS_URL set but redis lib missing — in-memory queue")
        _queue = InMemoryQueue()
    return _queue


def reset_queue() -> None:
    """Drop the singleton (tests get a fresh in-memory queue)."""
    global _queue
    _queue = None
