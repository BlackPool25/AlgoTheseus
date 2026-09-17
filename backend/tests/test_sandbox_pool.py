"""
test_sandbox_pool.py — Wave5 3.1 sandbox concurrency pool (HIGH tier).

Process-wide asyncio.Semaphore GLOBAL_SANDBOX_MAX=6 (env SANDBOX_MAX_CONCURRENT
default 6) wraps every run_in_sandbox; batch fan-out stays capped at
MAX_BATCH_SANDBOXES=4; g++ spawn guard caps compiler concurrency at 50.

RED test: 20 DISTINCT concurrent cold-cache /execute (distinct stdin defeats
Wave4 singleflight coalescing) with a mocked slow sandbox must return 20x200
with byte-equal trace payloads while max observed sandbox concurrency <= 6.
On the unbounded baseline this fails (max_observed ~= 20).
"""

from __future__ import annotations

import asyncio
from unittest.mock import patch

import pytest
from httpx import ASGITransport, AsyncClient

import app.api.routes.execute as execute_mod
from app.core.executor.docker_runner import RunResult
from app.main import app


@pytest.fixture(autouse=True)
def _fresh_limits():
    """Clear slowapi's in-memory counters — 20 concurrent posts must not
    starve neighboring tests sharing the 30/min bucket."""
    limiter = getattr(app.state, "limiter", None)
    storage = getattr(limiter, "_storage", None)
    if storage is not None:
        storage.reset()
    yield
    if storage is not None:
        storage.reset()


@pytest.fixture(autouse=True)
def _fresh_pool(monkeypatch):
    """Default pool size 6; drop the singleton between tests."""
    monkeypatch.delenv("SANDBOX_MAX_CONCURRENT", raising=False)
    execute_mod.reset_sandbox_pool()
    yield
    execute_mod.reset_sandbox_pool()


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


class TestSandboxPool:
    @patch("app.api.routes.execute.run_in_sandbox")
    @patch("app.api.routes.execute.instrument")
    @patch("app.api.routes.execute.parse_stdin")
    async def test_20_distinct_concurrent_max6(
        self,
        mock_parse_stdin,
        mock_instrument,
        mock_run,
    ):
        """20 distinct cold-cache posts → 6x200 + 14x429, pool caps concurrency <= 6.

        Wave6 3.2 fail-fast: the pool try-acquires without waiting, so only
        the first 6 claim slots; the rest get 429 saturated (never queued).
        """

        # Distinct stdin per request defeats singleflight (distinct result_key),
        # so the pool — not coalescing — is what bounds concurrency.
        async def fake_parse_stdin(code, raw_stdin):
            return raw_stdin, "no changes"

        mock_parse_stdin.side_effect = fake_parse_stdin
        mock_instrument.return_value = '#include "tracer.h"\nint main() {}'

        state = {"cur": 0, "max": 0, "n": 0}
        lock = asyncio.Lock()

        async def slow_sandbox(*a, **k):
            async with lock:
                state["cur"] += 1
                state["n"] += 1
                state["max"] = max(state["max"], state["cur"])
            try:
                await asyncio.sleep(0.3)
                return _ok_result()
            finally:
                async with lock:
                    state["cur"] -= 1

        mock_run.side_effect = slow_sandbox

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            responses = await asyncio.gather(
                *[
                    ac.post(
                        "/execute",
                        json={"code": "int main(){return 0;}", "raw_stdin": f"{i}\n"},
                    )
                    for i in range(20)
                ]
            )

        ok = [r for r in responses if r.status_code == 200]
        saturated = [r for r in responses if r.status_code == 429]
        assert len(ok) == 6, [(r.status_code, r.text[:200]) for r in responses]
        assert len(saturated) == 14, [(r.status_code, r.text[:200]) for r in responses]
        for r in saturated:
            assert r.json().get("detail") == "sandbox saturated, retry"
            assert r.headers.get("retry-after") == "5"
        assert len({r.text for r in ok}) == 1  # trace-equal bodies
        assert state["n"] == 6, f"sandbox ran {state['n']}x, want 6 (no coalescing)"
        assert state["max"] <= 6, f"max_observed={state['max']}, want <=6"

    def test_pool_defaults_to_6(self):
        """Env unset → pool size 6 (GLOBAL_SANDBOX_MAX)."""
        assert execute_mod.sandbox_max() == 6
        assert execute_mod.GLOBAL_SANDBOX_MAX == 6
