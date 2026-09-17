"""
test_coalescing.py — Wave4 2.3 in-process singleflight (HIGH tier).

20 concurrent identical cold-cache /execute with a mocked slow sandbox must
run the sandbox ONCE and return 20x200 byte-equal bodies.
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


class TestCoalescing:
    @patch("app.api.routes.execute.run_in_sandbox")
    @patch("app.api.routes.execute.instrument")
    @patch("app.api.routes.execute.parse_stdin")
    async def test_20_concurrent_identical_one_sandbox(
        self,
        mock_parse_stdin,
        mock_instrument,
        mock_run,
    ):
        """Cold cache + 20 identical concurrent posts → 1 sandbox, 20x200 equal."""
        mock_parse_stdin.return_value = ("7\n", "no changes")
        mock_instrument.return_value = '#include "tracer.h"\nint main() {}'
        calls = {"n": 0}

        async def slow_sandbox(*a, **k):
            calls["n"] += 1
            await asyncio.sleep(0.3)
            return _ok_result()

        mock_run.side_effect = slow_sandbox
        payload = {"code": CODE, "raw_stdin": "7\n"}

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            responses = await asyncio.gather(
                *[ac.post("/execute", json=payload) for _ in range(20)]
            )

        assert all(r.status_code == 200 for r in responses), [
            (r.status_code, r.text[:200]) for r in responses if r.status_code != 200
        ]
        assert len({r.text for r in responses}) == 1  # byte-equal bodies
        assert calls["n"] == 1, f"sandbox ran {calls['n']}x, want 1"

    async def test_cancelled_waiter_does_not_poison_shared_future(self):
        """Leader + 2 waiters on one key; cancel waiter-1 → leader + waiter-2
        still resolve OK with exactly 1 factory call."""
        calls = {"n": 0}

        async def slow_factory():
            calls["n"] += 1
            await asyncio.sleep(0.3)
            return "shared"

        leader = asyncio.ensure_future(execute_mod._coalesced("poison-key", slow_factory))
        await asyncio.sleep(0.05)
        waiter1 = asyncio.ensure_future(execute_mod._coalesced("poison-key", slow_factory))
        waiter2 = asyncio.ensure_future(execute_mod._coalesced("poison-key", slow_factory))
        await asyncio.sleep(0.05)
        waiter1.cancel()
        try:
            await waiter1
        except asyncio.CancelledError:
            pass
        assert await leader == "shared"
        assert await waiter2 == "shared"
        assert calls["n"] == 1, f"factory ran {calls['n']}x, want 1"
        assert not execute_mod._inflight
