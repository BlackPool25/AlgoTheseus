"""tests/test_budget.py — Free-tier execution budget: caps, 503s, fail-open.

No live Redis needed: fakeredis.aioredis.FakeRedis stands in for the
pooled client behind budget._get_redis_client.
"""

import pytest
from fastapi import HTTPException

fakeredis = pytest.importorskip("fakeredis")
from fakeredis.aioredis import FakeRedis

from app.core import budget


@pytest.fixture
def fake():
    client = FakeRedis()
    yield client


@pytest.fixture
def wired(fake, monkeypatch):
    monkeypatch.setattr(budget, "_get_redis_client", lambda: fake)
    return fake


def test_defaults_sane():
    assert budget.monthly_limit() == 1200000
    assert budget.daily_limit() == 1200000 // 31


async def test_under_cap_passes_and_counts(wired):
    await budget.consume_budget(2)
    month_keys = [k async for k in wired.scan_iter("theseus:budget:????-??")]
    day_keys = [k async for k in wired.scan_iter("theseus:budget:????-??-??")]
    assert len(month_keys) == 1 and len(day_keys) == 1
    assert int(await wired.get(month_keys[0])) == 2
    assert int(await wired.get(day_keys[0])) == 2


async def test_monthly_cap_503s(wired, monkeypatch):
    monkeypatch.setenv("MONTHLY_EXEC_LIMIT", "3")
    monkeypatch.setenv("DAILY_EXEC_LIMIT", "1000")
    await budget.consume_budget(3)
    with pytest.raises(HTTPException) as exc:
        await budget.consume_budget(1)
    assert exc.value.status_code == 503
    assert "Monthly" in exc.value.detail


async def test_daily_cap_503s(wired, monkeypatch):
    monkeypatch.setenv("MONTHLY_EXEC_LIMIT", "1000000")
    monkeypatch.setenv("DAILY_EXEC_LIMIT", "2")
    await budget.consume_budget(2)
    with pytest.raises(HTTPException) as exc:
        await budget.consume_budget(1)
    assert exc.value.status_code == 503
    assert "Daily" in exc.value.detail


async def test_batch_consume_counts_each_case(wired, monkeypatch):
    monkeypatch.setenv("MONTHLY_EXEC_LIMIT", "1000000")
    monkeypatch.setenv("DAILY_EXEC_LIMIT", "1000000")
    await budget.consume_budget(5)
    month_keys = [k async for k in wired.scan_iter("theseus:budget:????-??")]
    assert int(await wired.get(month_keys[0])) == 5


async def test_fail_open_without_redis(monkeypatch):
    monkeypatch.setattr(budget, "_get_redis_client", lambda: None)
    await budget.consume_budget(10**9)  # must not raise


async def test_fail_open_on_redis_error(monkeypatch):
    class Broken:
        async def eval(self, *a, **k):
            raise ConnectionError("down")

    monkeypatch.setattr(budget, "_get_redis_client", lambda: Broken())
    await budget.consume_budget(1)  # must not raise
