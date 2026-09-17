"""
test_eventloop_block.py — Wave3 2.1: the event loop must stay responsive
during heavy execution work.

Blocking sources moved off the loop via asyncio.to_thread:
  instrument() (libclang), SharedCache.get/put (sync file + sync Redis L1),
  parse_trace(), build_cfg(). run_in_sandbox() was already threaded.

Heartbeat contract: a 10ms ticker must never observe a gap >= 250ms while
_resolve() handles a 100k-line trace or _run_payload() parses/builds it.
"""

from __future__ import annotations

import asyncio
import json
import time

import pytest

import app.api.routes.execute as execute_mod
from app.core.executor.docker_runner import RunResult
from app.models.request import ExecuteRequest

_TICK = 0.01  # 10ms heartbeat
_MAX_GAP = 0.25  # 250ms ceiling
_N = 100_000  # MAX_TRACE_LINES

_STATE_LINE = json.dumps({"t": "state", "l": 1, "f": "main", "d": 0, "v": {"x": 1}})


def _big_trace() -> list[str]:
    return [_STATE_LINE] * _N


class _Heartbeat:
    """10ms ticker recording worst observed gap."""

    def __init__(self) -> None:
        self.gaps: list[float] = []
        self._stop = False
        self._task: asyncio.Task | None = None

    async def _beat(self) -> None:
        last = time.monotonic()
        while not self._stop:
            await asyncio.sleep(_TICK)
            now = time.monotonic()
            self.gaps.append(now - last)
            last = now

    async def __aenter__(self) -> _Heartbeat:
        self._task = asyncio.create_task(self._beat())
        await asyncio.sleep(0)  # let the ticker start
        return self

    async def __aexit__(self, *exc: object) -> None:
        self._stop = True
        assert self._task is not None
        await self._task

    @property
    def max_gap(self) -> float:
        return max(self.gaps) if self.gaps else 0.0


@pytest.fixture
def heavy_pipeline(monkeypatch):
    """Slow blocking instrument (libclang stand-in) + 100k-line sandbox hit."""
    import time as _time

    def slow_instrument(code: str) -> str:
        _time.sleep(0.6)  # blocking libclang-style CPU work
        return code + "\n// __TRACE_ x\n"

    async def fake_sandbox(src: str, stdin: str) -> RunResult:
        return RunResult(stdout="ok", trace_raw=_big_trace())

    monkeypatch.setattr(execute_mod, "instrument", slow_instrument)
    monkeypatch.setattr(execute_mod, "run_in_sandbox", fake_sandbox)


async def test_resolve_heartbeat_under_250ms(heavy_pipeline):
    """_resolve (instrument + cache file I/O) must not stall the loop."""
    req = ExecuteRequest(code="int main(){return 0;}", raw_stdin="")
    async with _Heartbeat() as hb:
        resolved = await execute_mod._resolve(req, kind="single")
    assert resolved.run_result is not None
    assert len(resolved.run_result.trace_raw) == _N
    assert (
        hb.max_gap < _MAX_GAP
    ), f"loop stalled {hb.max_gap*1000:.0f}ms during _resolve"


async def test_worker_payload_heartbeat_under_250ms(heavy_pipeline):
    """worker _run_payload (resolve + parse 100k + build CFG) must not stall."""
    from app import worker as worker_mod

    payload = {"code": "int main(){return 0;}", "raw_stdin": "", "compressed": True}
    async with _Heartbeat() as hb:
        result = await worker_mod._run_payload(payload)
    assert result["total_steps"] == 1  # 100k identical STATEs group into one
    assert (
        hb.max_gap < _MAX_GAP
    ), f"loop stalled {hb.max_gap*1000:.0f}ms during _run_payload"


async def test_stream_order_preserved(heavy_pipeline):
    """NDJSON streaming order unchanged: events in order, cfg last."""
    req = ExecuteRequest(code="int main(){return 0;}", raw_stdin="", compressed=True)
    resolved = await execute_mod._resolve(req, kind="single")
    lines = [
        json.loads(line.decode())
        async for line in execute_mod._stream_resolved(resolved)
    ]
    # compressed streaming collapses identical STATEs into one group event;
    # order contract: all events first, cfg last.
    assert len(lines) == 2
    assert lines[0]["type"] == "event"
    assert lines[0]["data"]["group_count"] == _N
    assert lines[-1]["type"] == "cfg"
