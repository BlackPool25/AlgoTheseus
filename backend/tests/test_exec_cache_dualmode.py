"""
test_exec_cache_dualmode.py — Todo 13 (viz-improvement-wave): mode-independent result cache.

``compressed`` is a read-time projection (``parse(raw, compressed=...)`` over
the stored ``trace_raw``), not a run-time property — so dual-mode clients
(JSON + NDJSON streaming) must share ONE cold pipeline entry.

Covers:
  - False-then-True: one cold run serves both modes; second mode is X-Cache: HIT.
  - True-then-False: same, reversed order (no order dependence).
  - Byte-correctness per mode: each payload equals the direct-parser baseline
    for its own mode (``parse(TRACE_DUP, compressed=<mode>)``) — payload bytes
    are the proof, not just HIT counters.
  - Projection is real: the modes' payloads DIFFER in the expected way
    (duplicate consecutive STATEs merge under compressed=True only).

All Docker calls are mocked; no Docker dependency.
"""

from __future__ import annotations

import json
from unittest.mock import patch

import pytest
from httpx import ASGITransport, AsyncClient

import app.api.routes.execute as execute_mod
from app.core.executor.docker_runner import RunResult
from app.core.trace.parser import parse as parse_trace
from app.main import app


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
def isolated_cache(tmp_path, monkeypatch):
    """Point the executor cache at a fresh tmp dir (and reset the singleton)."""
    cache_dir = tmp_path / "algo-theseus-cache"
    monkeypatch.setenv("CACHE_DIR", str(cache_dir))
    monkeypatch.setenv("CACHE_TTL_SECONDS", "3600")
    monkeypatch.setenv("CACHE_MAX_BYTES", str(512 * 1024 * 1024))
    execute_mod.reset_cache()
    yield cache_dir
    execute_mod.reset_cache()


CODE = "int main(){return 0;}"

# Two IDENTICAL consecutive STATEs: compressed=True merges them into one
# grouped event; compressed=False keeps both. The modes' payloads must differ
# exactly this way — proving the per-request projection ran over shared raw.
TRACE_DUP = [
    '{"t":"enter","l":5,"f":"main","d":1,"p":{}}',
    '{"t":"state","l":6,"f":"main","d":1,"v":{"i":1}}',
    '{"t":"state","l":6,"f":"main","d":1,"v":{"i":1}}',
    '{"t":"exit","l":7,"f":"main","d":1,"r":0}',
]


def _ok_result() -> RunResult:
    return RunResult(
        stdout="ok\n",
        stderr_clean="",
        trace_raw=list(TRACE_DUP),
        exit_code=0,
        timed_out=False,
        truncated=False,
    )


def _baseline(mode: bool) -> list:
    """Direct-parser payload bytes for one mode (JSON-normalized)."""
    return json.loads(
        json.dumps([e.model_dump(by_alias=False) for e in parse_trace(TRACE_DUP, compressed=mode)])
    )


def _stream_events(text: str) -> tuple[list, dict]:
    lines = [json.loads(line) for line in text.splitlines() if line.strip()]
    events = [line["data"] for line in lines if line["type"] == "event"]
    cfg = next(line for line in lines if line["type"] == "cfg")
    return events, cfg


class TestDualModeSharesOneColdRun:
    @patch("app.api.routes.execute.run_in_sandbox")
    @patch("app.api.routes.execute.instrument")
    @patch("app.api.routes.execute.parse_stdin")
    async def test_false_then_true_one_pipeline(
        self, mock_parse_stdin, mock_instrument, mock_run, isolated_cache
    ):
        """JSON first (cold), then streaming: HIT, one sandbox run, both byte-correct."""
        mock_parse_stdin.return_value = ("7\n", "no changes")
        mock_instrument.return_value = '#include "tracer.h"\nint main() {}'
        mock_run.return_value = _ok_result()

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r_json = await ac.post("/execute", json={"code": CODE, "raw_stdin": "7\n"})
            assert r_json.headers.get("x-cache") == "MISS"
            r_stream = await ac.post(
                "/execute", json={"code": CODE, "raw_stdin": "7\n", "compressed": True}
            )

        assert r_stream.headers.get("x-cache") == "HIT", r_stream.headers
        assert mock_run.await_count == 1, f"dual-mode must run one cold pipeline, ran {mock_run.await_count}"

        # Byte-correctness per mode against single-mode parser baselines.
        assert r_json.json()["trace"] == _baseline(False)
        events, cfg = _stream_events(r_stream.text)
        assert events == _baseline(True)
        assert cfg["total_steps"] == len(_baseline(True))
        # Projection is real: merged (3) vs flat (4) event counts.
        assert len(r_json.json()["trace"]) == 4
        assert len(events) == 3

    @patch("app.api.routes.execute.run_in_sandbox")
    @patch("app.api.routes.execute.instrument")
    @patch("app.api.routes.execute.parse_stdin")
    async def test_true_then_false_one_pipeline(
        self, mock_parse_stdin, mock_instrument, mock_run, isolated_cache
    ):
        """Streaming first (cold), then JSON: HIT, one sandbox run, both byte-correct."""
        mock_parse_stdin.return_value = ("7\n", "no changes")
        mock_instrument.return_value = '#include "tracer.h"\nint main() {}'
        mock_run.return_value = _ok_result()

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r_stream = await ac.post(
                "/execute", json={"code": CODE, "raw_stdin": "7\n", "compressed": True}
            )
            assert r_stream.headers.get("x-cache") == "MISS"
            r_json = await ac.post("/execute", json={"code": CODE, "raw_stdin": "7\n"})

        assert r_json.headers.get("x-cache") == "HIT", r_json.headers
        assert mock_run.await_count == 1, f"dual-mode must run one cold pipeline, ran {mock_run.await_count}"

        events, cfg = _stream_events(r_stream.text)
        assert events == _baseline(True)
        assert cfg["total_steps"] == len(_baseline(True))
        assert r_json.json()["trace"] == _baseline(False)
        assert len(events) == 3
        assert len(r_json.json()["trace"]) == 4
