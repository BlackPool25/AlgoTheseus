"""
tests/test_rate_limits_distributed.py — Wave2 1.2 distributed limiter.

Two AsyncClients share ONE fakeredis behind the same app: the Redis
fixed-window (``theseus:rl:<scope>:<key>:<minute>`` via Lua INCR+EXPIRE
60s) is the global authority, so 30x200 then 429s with integer Retry-After
no matter which client sends.

Cross-instance simulation: slowapi's in-memory counters are per-process,
so mid-run we wipe them (a fresh replica has empty memory but the same
Redis) and the global budget must still hold — pure in-memory counting
would restart the budget at that point (RED on the old code).

All sandbox calls are mocked so tests run without Docker.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest
from fakeredis.aioredis import FakeRedis
from httpx import ASGITransport, AsyncClient

import app.core.rate_limit as rl
from app.core.executor.docker_runner import RunResult
from app.main import app

VALID_BODY = {"code": "int main(){return 0;}", "raw_stdin": ""}

OK_RUN = RunResult(
    stdout="",
    stderr_clean="",
    trace_raw=[],
    exit_code=0,
    timed_out=False,
    truncated=False,
)

PINNED_MINUTE = 27000000


def _reset_limiter_storage() -> None:
    """Clear slowapi's in-memory counters (simulates a fresh replica)."""
    limiter = getattr(app.state, "limiter", None)
    storage = getattr(limiter, "_storage", None)
    if storage is not None:
        storage.reset()


@pytest.fixture()
def _distrib(monkeypatch):
    """One shared fakeredis behind the app; fixed minute bucket."""
    fake = FakeRedis(decode_responses=True)
    monkeypatch.setattr(rl, "_get_redis_client", lambda: fake)
    monkeypatch.setattr(rl, "_current_minute", lambda: PINNED_MINUTE)
    _reset_limiter_storage()
    yield fake
    _reset_limiter_storage()


def _mocked_sandbox():
    """Mock instrument/parse_stdin/run_in_sandbox (no Docker needed)."""
    return (
        patch("app.api.routes.execute.run_in_sandbox", return_value=OK_RUN),
        patch("app.api.routes.execute.instrument", return_value="int main(){}"),
        patch("app.api.routes.execute.parse_stdin", return_value=("", "no changes")),
    )


class TestSharedExecuteBudget:
    async def test_30x200_then_429s_from_either_client(self, _distrib):
        """Alternating clients, one replica-hop: global 30 then 429s both ways."""
        fake = _distrib
        ip = "10.99.11.1"
        p0, p1, p2 = _mocked_sandbox()
        with p0, p1, p2:
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as ac1, AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as ac2:
                statuses = []
                retry_afters = []
                ac1_429s = ac2_429s = 0
                for i in range(35):
                    if i == 12:
                        # Hop to a fresh replica: empty slowapi memory,
                        # same shared Redis. Old code restarts the budget.
                        _reset_limiter_storage()
                    ac = ac1 if i % 2 == 0 else ac2
                    r = await ac.post(
                        "/execute",
                        json=VALID_BODY,
                        headers={"X-Forwarded-For": ip},
                    )
                    statuses.append(r.status_code)
                    if r.status_code == 429:
                        retry_afters.append(r.headers.get("Retry-After"))
                        if ac is ac1:
                            ac1_429s += 1
                        else:
                            ac2_429s += 1

        assert statuses[:30] == [200] * 30
        assert statuses[30:] == [429] * 5
        assert len(retry_afters) == 5
        assert all(v is not None and int(v) >= 1 for v in retry_afters)
        assert ac1_429s == 3 and ac2_429s == 2  # 429s arrived via BOTH clients

        # Lua fixed-window key format + every attempt counted + 60s TTL.
        val = await fake.get(f"theseus:rl:execute:{ip}:{PINNED_MINUTE}")
        assert val == "35"
        ttl = await fake.ttl(f"theseus:rl:execute:{ip}:{PINNED_MINUTE}")
        assert 0 < ttl <= 60

    async def test_422_does_not_consume_distributed_quota(self, _distrib):
        """Validation runs first: 5x422 + 30x200, the 31st valid is 429."""
        fake = _distrib
        ip = "10.99.11.2"
        p0, p1, p2 = _mocked_sandbox()
        with p0, p1, p2:
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as ac:
                for _ in range(5):
                    r = await ac.post(
                        "/execute",
                        json={},
                        headers={"X-Forwarded-For": ip},
                    )
                    assert r.status_code == 422
                oks = [
                    (
                        await ac.post(
                            "/execute",
                            json=VALID_BODY,
                            headers={"X-Forwarded-For": ip},
                        )
                    ).status_code
                    for _ in range(31)
                ]
        assert oks[:30] == [200] * 30
        assert oks[30] == 429
        val = await fake.get(f"theseus:rl:execute:{ip}:{PINNED_MINUTE}")
        assert val == "31"  # the five 422s never touched Redis


class TestJobsSharedBudget:
    async def test_jobs_30x202_then_429(self, _distrib):
        fake = _distrib
        ip = "10.99.11.3"
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as ac:
            statuses = []
            retry_after = None
            for _ in range(31):
                r = await ac.post(
                    "/jobs",
                    json=VALID_BODY,
                    headers={"X-Forwarded-For": ip},
                )
                statuses.append(r.status_code)
                if r.status_code == 429:
                    retry_after = r.headers.get("Retry-After")
        assert statuses[:30] == [202] * 30
        assert statuses[30] == 429
        assert retry_after is not None and int(retry_after) >= 1
        val = await fake.get(f"theseus:rl:jobs:{ip}:{PINNED_MINUTE}")
        assert val == "31"


class TestRedisDownFailOpen:
    async def test_redis_errors_never_500(self, monkeypatch):
        """Dead Redis: warning + local in-memory limits still apply, no 500."""

        class _Dead:
            async def eval(self, *a, **k):
                raise ConnectionError("redis down")

        monkeypatch.setattr(rl, "_get_redis_client", lambda: _Dead())
        _reset_limiter_storage()
        try:
            p0, p1, p2 = _mocked_sandbox()
            with p0, p1, p2:
                async with AsyncClient(
                    transport=ASGITransport(app=app), base_url="http://test"
                ) as ac:
                    statuses = [
                        (
                            await ac.post(
                                "/execute",
                                json=VALID_BODY,
                                headers={"X-Forwarded-For": "10.99.11.4"},
                            )
                        ).status_code
                        for _ in range(35)
                    ]
        finally:
            _reset_limiter_storage()
        assert 500 not in statuses
        assert statuses[:30] == [200] * 30
        assert statuses[30:] == [429] * 5


def test_scope_for_paths():
    assert rl._scope_for("/execute") == "execute"
    assert rl._scope_for("/execute-batch") == "batch"
    assert rl._scope_for("/jobs") == "jobs"
    assert rl._scope_for("/jobs/abc") == "jobs"
