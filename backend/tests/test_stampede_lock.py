"""
test_stampede_lock.py — Wave6 3.3 Redis stampede lock (HIGH tier).

Cross-instance singleflight: before the sandbox run, the holder does
``SET theseus:lock:<result_key> <token> NX PX 15000``; the holder runs the
sandbox and populates the shared cache; non-holders poll the shared cache
for 15s at 100ms intervals (-> HIT). Poll timeout -> run anyway (fail-open,
<=2x runs). Release is holder-only via a Lua compare-del. Redis down ->
skip the lock entirely (fail-open, endpoint never 500).

No live Redis needed: fakeredis.FakeStrictRedis is the shared L1 client
(same object across "instances" = cross-instance HIT).

To prove the LOCK (not the in-process Wave4 singleflight) dedups, the main
test bypasses ``_coalesced`` with a pass-through — simulating 10 separate
processes, each with its own singleflight map, hitting the same result_key.
Baseline (no lock): 10 sandbox runs. With the lock: exactly 1.
"""

from __future__ import annotations

import asyncio
from unittest.mock import patch

from httpx import ASGITransport, AsyncClient

import app.api.routes.execute as execute_mod
from app.core.executor.cache import SharedCache
from app.core.executor.docker_runner import RunResult
from app.main import app

import pytest

fakeredis = pytest.importorskip("fakeredis")


@pytest.fixture(autouse=True)
def _fresh_limits():
    """Clear slowapi's counters — 10 concurrent posts must not starve others."""
    limiter = getattr(app.state, "limiter", None)
    storage = getattr(limiter, "_storage", None)
    if storage is not None:
        storage.reset()
    yield
    if storage is not None:
        storage.reset()


CODE = "int main(){return 0;}"

TRACE_4 = [
    '{"t":"enter","l":5,"f":"bsearch","d":1,"p":{"arr":[1,3,5,7,9],"target":7}}',
    '{"t":"state","l":6,"f":"bsearch","d":1,"v":{"lo":0,"hi":4}}',
    '{"t":"state","l":8,"f":"bsearch","d":1,"v":{"lo":3,"hi":4}}',
    '{"t":"exit","l":10,"f":"bsearch","d":1,"r":3}',
]


def _ok_result() -> RunResult:
    return RunResult(
        stdout="Found\n",
        stderr_clean="",
        trace_raw=list(TRACE_4),
        exit_code=0,
        timed_out=False,
        truncated=False,
    )


async def _no_coalesce(key: str, factory):
    """Pass-through singleflight: simulates N separate processes (N maps)."""
    return await factory()


def _shared_cache(tmp_path, fake, sub: str) -> SharedCache:
    return SharedCache(l2_dir=str(tmp_path / sub), redis_client=fake)


class TestStampedeLock:
    @patch("app.api.routes.execute.run_in_sandbox")
    @patch("app.api.routes.execute.instrument")
    @patch("app.api.routes.execute.parse_stdin")
    async def test_10_distinct_singleflights_one_sandbox(
        self,
        mock_parse_stdin,
        mock_instrument,
        mock_run,
        tmp_path,
    ):
        """10 separate singleflight maps, 1 result_key -> 1 sandbox run."""
        mock_parse_stdin.return_value = ("7\n", "no changes")
        mock_instrument.return_value = '#include "tracer.h"\nint main() {}'
        calls = {"n": 0}

        async def slow_sandbox(*a, **k):
            calls["n"] += 1
            await asyncio.sleep(0.3)
            return _ok_result()

        mock_run.side_effect = slow_sandbox
        fake = fakeredis.FakeStrictRedis()
        execute_mod.reset_cache()
        try:
            execute_mod._cache = _shared_cache(tmp_path, fake, "a")
            payload = {"code": CODE, "raw_stdin": "7\n"}
            with patch.object(
                execute_mod,
                "_coalesced",
                side_effect=_no_coalesce,
            ):
                async with AsyncClient(
                    transport=ASGITransport(app=app), base_url="http://test"
                ) as ac:
                    responses = await asyncio.gather(
                        *[ac.post("/execute", json=payload) for _ in range(10)]
                    )
            assert all(r.status_code == 200 for r in responses), [
                (r.status_code, r.text[:200]) for r in responses if r.status_code != 200
            ]
            assert len({r.text for r in responses}) == 1  # byte-equal bodies
            assert calls["n"] == 1, f"sandbox ran {calls['n']}x, want 1"
            headers = [r.headers.get("x-cache") for r in responses]
            assert headers.count("MISS") == 1  # holder only
            assert headers.count("HIT") == 9  # waiters poll-hit shared cache
        finally:
            execute_mod.reset_cache()

    @patch("app.api.routes.execute.run_in_sandbox")
    @patch("app.api.routes.execute.instrument")
    @patch("app.api.routes.execute.parse_stdin")
    async def test_poll_timeout_runs_anyway(
        self,
        mock_parse_stdin,
        mock_instrument,
        mock_run,
        tmp_path,
        monkeypatch,
    ):
        """Holder slower than the poll window -> waiter runs anyway (<=2x)."""
        monkeypatch.setattr(execute_mod, "STAMPEDE_POLL_TIMEOUT", 0.4)
        monkeypatch.setattr(execute_mod, "STAMPEDE_POLL_INTERVAL", 0.05)
        mock_parse_stdin.return_value = ("7\n", "no changes")
        mock_instrument.return_value = '#include "tracer.h"\nint main() {}'
        calls = {"n": 0}

        async def very_slow_sandbox(*a, **k):
            calls["n"] += 1
            await asyncio.sleep(2.0)
            return _ok_result()

        mock_run.side_effect = very_slow_sandbox
        fake = fakeredis.FakeStrictRedis()
        execute_mod.reset_cache()
        try:
            execute_mod._cache = _shared_cache(tmp_path, fake, "a")
            payload = {"code": CODE, "raw_stdin": "7\n"}
            with patch.object(
                execute_mod,
                "_coalesced",
                side_effect=_no_coalesce,
            ):
                async with AsyncClient(
                    transport=ASGITransport(app=app), base_url="http://test"
                ) as ac:
                    responses = await asyncio.gather(
                        *[ac.post("/execute", json=payload) for _ in range(2)]
                    )
            assert all(r.status_code == 200 for r in responses)
            assert calls["n"] <= 2, f"sandbox ran {calls['n']}x, want <=2"
            assert calls["n"] == 2  # waiter timed out and ran anyway
        finally:
            execute_mod.reset_cache()

    @patch("app.api.routes.execute.run_in_sandbox")
    @patch("app.api.routes.execute.instrument")
    @patch("app.api.routes.execute.parse_stdin")
    async def test_redis_down_skips_lock_fail_open(
        self,
        mock_parse_stdin,
        mock_instrument,
        mock_run,
        tmp_path,
    ):
        """L1 down -> lock skipped, request still 200 MISS (never 500)."""

        class BoomRedis:
            def get(self, *a, **k):
                raise ConnectionError("redis down")

            def set(self, *a, **k):
                raise ConnectionError("redis down")

            def setex(self, *a, **k):
                raise ConnectionError("redis down")

            def delete(self, *a, **k):
                raise ConnectionError("redis down")

            def eval(self, *a, **k):
                raise ConnectionError("redis down")

        mock_parse_stdin.return_value = ("7\n", "no changes")
        mock_instrument.return_value = '#include "tracer.h"\nint main() {}'
        mock_run.return_value = _ok_result()
        execute_mod.reset_cache()
        try:
            execute_mod._cache = _shared_cache(tmp_path, BoomRedis(), "a")
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as ac:
                r = await ac.post("/execute", json={"code": CODE, "raw_stdin": "7\n"})
            assert r.status_code == 200
            assert r.headers.get("x-cache") == "MISS"
        finally:
            execute_mod.reset_cache()


class TestLockPrimitives:
    def test_release_is_holder_only(self):
        """Wrong token cannot release; right token releases (Lua compare-del)."""
        fake = fakeredis.FakeStrictRedis()
        cache = SharedCache(l2_dir="/tmp/algotheseus-stampede-probe", redis_client=fake)
        token, should_poll = execute_mod._stampede_try_acquire(cache, "rk1")
        assert token is not None and not should_poll
        _, should_poll2 = execute_mod._stampede_try_acquire(cache, "rk1")
        assert should_poll2  # locked by holder
        execute_mod._stampede_release(cache, "rk1", "wrong-token")
        _, still_locked = execute_mod._stampede_try_acquire(cache, "rk1")
        assert still_locked  # stranger's release was a no-op
        execute_mod._stampede_release(cache, "rk1", token)
        token2, should_poll3 = execute_mod._stampede_try_acquire(cache, "rk1")
        assert token2 is not None and not should_poll3  # holder released
        execute_mod._stampede_release(cache, "rk1", token2)

    def test_lock_expiry_fallback(self, monkeypatch):
        """PX expiry frees the lock: a crashed holder never blocks forever."""
        monkeypatch.setattr(execute_mod, "STAMPEDE_LOCK_TTL_MS", 50)
        fake = fakeredis.FakeStrictRedis()
        cache = SharedCache(l2_dir="/tmp/algotheseus-stampede-probe", redis_client=fake)
        token, _ = execute_mod._stampede_try_acquire(cache, "rk-exp")
        assert token is not None
        # Holder "crashes" (never releases, never populates cache)...
        import time as _time

        _time.sleep(0.2)  # ...PX lapses...
        token2, should_poll = execute_mod._stampede_try_acquire(cache, "rk-exp")
        assert token2 is not None and not should_poll  # ...lock free again
        execute_mod._stampede_release(cache, "rk-exp", token2)

    def test_no_l1_runs_without_lock(self, tmp_path):
        """No Redis configured -> acquire reports run-directly (no poll)."""
        cache = SharedCache(l2_dir=str(tmp_path / "nol1"))
        token, should_poll = execute_mod._stampede_try_acquire(cache, "rk")
        assert token is None and not should_poll
        execute_mod._stampede_release(cache, "rk", None)  # no-op, never raises
