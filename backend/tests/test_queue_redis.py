"""tests/test_queue_redis.py — Wave1 1.1 pooled RedisQueue default.

Live-Redis tests (db 15 on localhost:6399 test container). Skipped when
Redis is unreachable so CI without Redis stays green.

Covers:
  - enqueue -> dequeue roundtrip
  - result record TTL is 1h (3600s)
  - cross-instance visibility (enqueue q1, dequeue q2)
  - ONE process-wide pooled client shared by all RedisQueue instances
    with max_connections=50, socket_connect_timeout=2,
    socket_keepalive=True, health_check_interval=30
  - get_queue() returns RedisQueue when REDIS_URL set, else InMemoryQueue
"""

from __future__ import annotations

import asyncio

import pytest

from app.core.queue import backends as B

TEST_REDIS_URL = "redis://localhost:6399/15"


async def _ping(aioredis) -> None:  # type: ignore[no-untyped-def]
    c = aioredis.from_url(TEST_REDIS_URL, decode_responses=True)
    try:
        await c.ping()
    finally:
        await c.aclose()


@pytest.fixture()
def _redis_available():
    try:
        import redis.asyncio as aioredis
    except Exception:  # noqa: BLE001 — any import failure means skip
        pytest.skip("redis package not installed")
    try:
        asyncio.run(_ping(aioredis))
    except Exception:  # noqa: BLE001 — unreachable Redis means skip
        pytest.skip("test Redis unreachable at localhost:6399")


async def _flush() -> None:
    from redis import asyncio as aioredis

    c = aioredis.from_url(TEST_REDIS_URL, decode_responses=True)
    try:
        await c.flushdb()
    finally:
        await c.aclose()


@pytest.mark.asyncio
async def test_enqueue_dequeue_roundtrip(_redis_available):
    await _flush()
    q = B.RedisQueue(TEST_REDIS_URL)
    job_id = await q.enqueue({"code": "int main(){}"})
    item = await q.dequeue(timeout=2)
    assert item is not None
    got_id, payload = item
    assert got_id == job_id
    assert payload == {"code": "int main(){}"}
    await B.reset_pool()


@pytest.mark.asyncio
async def test_result_ttl_is_1h(_redis_available):
    await _flush()
    from redis import asyncio as aioredis

    q = B.RedisQueue(TEST_REDIS_URL)
    job_id = await q.enqueue({"code": "x"})
    c = aioredis.from_url(TEST_REDIS_URL, decode_responses=True)
    try:
        ttl = await c.ttl(f"{B.RESULT_KEY_PREFIX}{job_id}")
    finally:
        await c.aclose()
    assert ttl is not None and 3500 < ttl <= B.RESULT_TTL_SECONDS == 3600
    await B.reset_pool()


@pytest.mark.asyncio
async def test_cross_instance_visibility(_redis_available):
    await _flush()
    q1 = B.RedisQueue(TEST_REDIS_URL)
    q2 = B.RedisQueue(TEST_REDIS_URL)
    job_id = await q1.enqueue({"code": "shared"})
    item = await q2.dequeue(timeout=2)
    assert item is not None
    assert item[0] == job_id
    assert item[1] == {"code": "shared"}
    rec = await q1.get(job_id)
    assert rec is not None and rec["job_id"] == job_id
    await B.reset_pool()


@pytest.mark.asyncio
async def test_pooled_client_shared_process_wide(_redis_available):
    await B.reset_pool()
    q1 = B.RedisQueue(TEST_REDIS_URL)
    q2 = B.RedisQueue(TEST_REDIS_URL)
    assert q1._client() is q2._client()
    await B.reset_pool()


@pytest.mark.asyncio
async def test_pool_options(_redis_available):
    await B.reset_pool()
    q = B.RedisQueue(TEST_REDIS_URL)
    pool = q._client().connection_pool
    assert pool.max_connections == 50
    kw = pool.connection_kwargs
    assert kw.get("socket_connect_timeout") == 2
    assert kw.get("socket_keepalive") is True
    assert kw.get("health_check_interval") == 30
    await B.reset_pool()


def test_get_queue_selects_backend(monkeypatch):
    monkeypatch.delenv("REDIS_URL", raising=False)
    B.reset_queue()
    try:
        assert isinstance(B.get_queue(), B.InMemoryQueue)
    finally:
        B.reset_queue()
    monkeypatch.setenv("REDIS_URL", TEST_REDIS_URL)
    B.reset_queue()
    try:
        assert isinstance(B.get_queue(), B.RedisQueue)
    finally:
        B.reset_queue()
