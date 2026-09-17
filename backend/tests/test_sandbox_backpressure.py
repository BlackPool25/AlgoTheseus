"""
test_sandbox_backpressure.py — Wave6 3.2 fail-fast 429 on pool saturation.

Pool saturated (N blocking 5s mock runs) → N+1th POST /execute returns
429 {"detail": "sandbox saturated, retry"} + Retry-After 5 in <50ms (never
queued). Batch saturated cases fail individually with
runtime_error="saturated, retry". /jobs stays 202 (queue, unaffected).
"""

from __future__ import annotations

import asyncio
import time
from unittest.mock import patch

import pytest
from httpx import ASGITransport, AsyncClient

import app.api.routes.execute as execute_mod
from app.core.executor.docker_runner import RunResult
from app.main import app


@pytest.fixture(autouse=True)
def _fresh_limits():
    limiter = getattr(app.state, "limiter", None)
    storage = getattr(limiter, "_storage", None)
    if storage is not None:
        storage.reset()
    yield
    if storage is not None:
        storage.reset()


@pytest.fixture(autouse=True)
def _small_pool(monkeypatch):
    """Pool size 2 so the test saturates fast; drop singletons between tests."""
    monkeypatch.setenv("SANDBOX_MAX_CONCURRENT", "2")
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


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


class TestBackpressure:
    @patch("app.api.routes.execute.run_in_sandbox")
    @patch("app.api.routes.execute.instrument")
    @patch("app.api.routes.execute.parse_stdin")
    async def test_n_plus_1_fails_fast_429(
        self,
        mock_parse_stdin,
        mock_instrument,
        mock_run,
    ):
        """Saturate pool (2× 5s runs) → 3rd POST /execute → 429 <50ms, not queued."""
        entered = asyncio.Event()
        release = asyncio.Event()

        async def fake_parse_stdin(code, raw_stdin):
            return raw_stdin, "no changes"

        mock_parse_stdin.side_effect = fake_parse_stdin
        mock_instrument.return_value = '#include "tracer.h"\nint main() {}'

        state = {"n": 0}

        async def blocking_sandbox(*a, **k):
            state["n"] += 1
            if state["n"] <= 2:
                entered.set() if state["n"] == 2 else None
                await release.wait()  # hold the slot ~forever (test releases)
                return _ok_result()
            # N+1th must never reach the sandbox (fail-fast before acquire)
            pytest.fail("saturated request reached run_in_sandbox — it queued!")

        mock_run.side_effect = blocking_sandbox

        async with _client() as ac:
            # Occupy both slots with distinct stdin (defeats singleflight).
            holders = [
                asyncio.create_task(
                    ac.post(
                        "/execute",
                        json={
                            "code": "int main(){return 0;}",
                            "raw_stdin": f"hold-{i}\n",
                        },
                    )
                )
                for i in range(2)
            ]
            # Wait until both holders are inside the sandbox.
            for _ in range(100):
                if state["n"] >= 2:
                    break
                await asyncio.sleep(0.05)
            assert state["n"] == 2, f"sandbox ran {state['n']}x, want 2 holders"

            # N+1th: must fail fast.
            t0 = time.perf_counter()
            r = await ac.post(
                "/execute",
                json={"code": "int main(){return 0;}", "raw_stdin": "extra\n"},
            )
            dt_ms = (time.perf_counter() - t0) * 1000

            assert r.status_code == 429, f"want 429, got {r.status_code}: {r.text[:200]}"
            assert r.json().get("detail") == "sandbox saturated, retry"
            assert r.headers.get("retry-after") == "5", dict(r.headers)
            assert dt_ms < 50, f"N+1th took {dt_ms:.1f}ms — it queued instead of failing fast"

            release.set()  # let holders finish
            holder_resps = await asyncio.gather(*holders)
            assert all(x.status_code == 200 for x in holder_resps)

    @patch("app.api.routes.execute.run_in_sandbox")
    @patch("app.api.routes.execute.instrument")
    @patch("app.api.routes.execute.parse_stdin")
    async def test_saturated_429_distinct_from_slowapi(
        self,
        mock_parse_stdin,
        mock_instrument,
        mock_run,
    ):
        """Saturation 429 detail differs from slowapi's rate-limit 429 body."""

        async def fake_parse(code, raw):
            return raw, "no changes"

        mock_parse_stdin.side_effect = fake_parse
        mock_instrument.return_value = '#include "tracer.h"\nint main() {}'

        release = asyncio.Event()
        state = {"n": 0}

        async def blocking_sandbox(*a, **k):
            state["n"] += 1
            await release.wait()
            return _ok_result()

        mock_run.side_effect = blocking_sandbox

        async with _client() as ac:
            holders = [
                asyncio.create_task(
                    ac.post(
                        "/execute",
                        json={"code": "int main(){return 0;}", "raw_stdin": f"h{i}\n"},
                    )
                )
                for i in range(2)
            ]
            for _ in range(100):
                if state["n"] >= 2:
                    break
                await asyncio.sleep(0.05)
            assert state["n"] == 2

            r = await ac.post(
                "/execute", json={"code": "int main(){return 0;}", "raw_stdin": "z\n"}
            )
            assert r.status_code == 429
            body = r.text
            assert "sandbox saturated, retry" in body
            assert "Rate limit exceeded" not in body  # slowapi's phrasing, must differ

            release.set()
            await asyncio.gather(*holders)

    async def test_jobs_unaffected_returns_202(self):
        """POST /jobs never touches the pool → 202 even with no sandbox mocks."""
        async with _client() as ac:
            r = await ac.post("/jobs", json={"code": "int main(){return 0;}", "raw_stdin": "1\n"})
            assert r.status_code == 202, f"want 202, got {r.status_code}: {r.text[:200]}"
