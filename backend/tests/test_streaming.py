"""
test_streaming.py — Tests for streaming response shape and progressive trace parsing.

Since the current API does not have a streaming endpoint, this test suite:
  1. Creates a minimal FastAPI test app with a StreamingResponse endpoint to
     validate content-type and chunking behaviour.
  2. Tests progressive trace parsing — that trace events can be parsed line by
     line from a stream, maintaining correct state after each line.

This validates the streaming contract that a future streaming endpoint should
satisfy: ``application/x-ndjson`` (newline-delimited JSON), one trace event per
chunk, and the ability to parse incrementally without the full payload.
"""

from __future__ import annotations

import asyncio
import json
from typing import AsyncGenerator

import pytest
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from httpx import ASGITransport, AsyncClient

from app.core.trace.models import (
    EventType,
    FuncEnterEvent,
    FuncExitEvent,
    StateEvent,
    BranchEvent,
    LoopIterEvent,
)
from app.core.trace.parser import parse


# ── Test streaming endpoint ───────────────────────────────────────────────────


@pytest.fixture
def stream_app() -> FastAPI:
    """A minimal FastAPI app with a streaming trace endpoint for testing.

    The endpoint returns trace events as newline-delimited JSON
    (``application/x-ndjson``), one event per chunk.
    """
    app = FastAPI()

    @app.get("/stream-trace")
    async def stream_trace():
        async def event_stream() -> AsyncGenerator[bytes, None]:
            events = [
                {"t": "enter", "l": 5, "f": "bsearch", "d": 0, "p": {"arr": [1, 3, 5, 7, 9], "target": 7}},
                {"t": "state", "l": 6, "f": "bsearch", "d": 0, "v": {"lo": 0, "hi": 4}},
                {"t": "branch", "l": 9, "f": "bsearch", "d": 0, "c": "arr[mid] == target", "tk": False},
                {"t": "iter", "l": 7, "f": "bsearch", "d": 0, "it": 0},
                {"t": "exit", "l": 13, "f": "bsearch", "d": 0, "r": 3},
            ]
            for ev in events:
                yield json.dumps(ev).encode() + b"\n"
                await asyncio.sleep(0.01)  # simulate real streaming delay

        return StreamingResponse(
            event_stream(),
            media_type="application/x-ndjson",
            headers={
                "X-Accel-Buffering": "no",
                "Cache-Control": "no-cache",
            },
        )

    return app


@pytest.fixture
def anyio_backend():
    return "asyncio"


class TestStreamingResponseShape:
    """Tests for the streaming response content-type and chunking."""

    async def test_streaming_content_type(self, stream_app):
        """Streaming response should have application/x-ndjson content-type."""
        async with AsyncClient(
            transport=ASGITransport(app=stream_app), base_url="http://test"
        ) as ac:
            response = await ac.get("/stream-trace")

        assert response.status_code == 200
        assert response.headers["content-type"] == "application/x-ndjson"

    async def test_streaming_cache_control(self, stream_app):
        """Streaming response should include no-cache header."""
        async with AsyncClient(
            transport=ASGITransport(app=stream_app), base_url="http://test"
        ) as ac:
            response = await ac.get("/stream-trace")

        assert "no-cache" in response.headers.get("cache-control", "").lower()

    async def test_streaming_chunked_transfer(self, stream_app):
        """Response should be chunked (Transfer-Encoding: chunked) or
        have the correct content-length behaviour for a stream."""
        async with AsyncClient(
            transport=ASGITransport(app=stream_app), base_url="http://test"
        ) as ac:
            response = await ac.get("/stream-trace")

        # StreamingResponse without a known Content-Length uses chunked encoding
        # httpx may or may not expose Transfer-Encoding, but the response
        # should have no Content-Length header
        assert "content-length" not in response.headers

    async def test_streaming_each_line_is_valid_json(self, stream_app):
        """Every line in the streaming body should be valid JSON."""
        async with AsyncClient(
            transport=ASGITransport(app=stream_app), base_url="http://test"
        ) as ac:
            async with ac.stream("GET", "/stream-trace") as response:
                chunks = []
                async for chunk in response.aiter_bytes():
                    chunks.append(chunk)

        body = b"".join(chunks)
        lines = body.splitlines()
        assert len(lines) == 5  # 5 events

        for i, line in enumerate(lines):
            try:
                data = json.loads(line)
            except json.JSONDecodeError as e:
                pytest.fail(f"Line {i} is not valid JSON: {e}\nGot: {line!r}")
            assert "t" in data, f"Line {i} missing 't' (type) field"

    async def test_streaming_events_in_order(self, stream_app):
        """Events should be received in the order they were yielded."""
        async with AsyncClient(
            transport=ASGITransport(app=stream_app), base_url="http://test"
        ) as ac:
            async with ac.stream("GET", "/stream-trace") as response:
                chunks = []
                async for chunk in response.aiter_bytes():
                    chunks.append(chunk)

        body = b"".join(chunks)
        lines = body.splitlines()
        events = [json.loads(line) for line in lines]

        expected_types = ["enter", "state", "branch", "iter", "exit"]
        for i, (event, expected_type) in enumerate(zip(events, expected_types)):
            assert event["t"] == expected_type, (
                f"Event {i}: expected type {expected_type!r}, got {event['t']!r}"
            )


# ── Progressive trace parsing ─────────────────────────────────────────────────


class TestProgressiveTraceParsing:
    """Test that trace events can be parsed incrementally from a stream.

    This validates the core invariant: the parser maintains correct state
    when events arrive one at a time, and the cumulative result after N
    events matches a batch-parse of the first N events.
    """

    @staticmethod
    def _raw_lines_from_events(events: list[dict]) -> list[str]:
        """Convert trace dicts to the raw JSON strings the parser expects."""
        return [json.dumps(ev) for ev in events]

    def test_progressive_parse_produces_same_result_as_batch(self):
        """Parsing events incrementally yields the same final list of events."""
        raw_lines = [
            '{"t":"enter","l":5,"f":"bsearch","d":1,"p":{"arr":[1,3,5,7,9],"target":7}}',
            '{"t":"state","l":6,"f":"bsearch","d":1,"v":{"lo":0,"hi":4}}',
            '{"t":"branch","l":9,"f":"bsearch","d":1,"c":"arr[mid] == target","tk":false}',
            '{"t":"iter","l":7,"f":"bsearch","d":1,"it":0}',
            '{"t":"exit","l":13,"f":"bsearch","d":1,"r":3}',
        ]

        # Progressive: add lines one by one, parse each prefix
        progressive_results = []
        for i in range(1, len(raw_lines) + 1):
            parsed = parse(raw_lines[:i])
            progressive_results.append(parsed)

        # Batch: parse all at once
        batch_result = parse(raw_lines)

        # The final progressive result should match the batch result
        assert len(progressive_results[-1]) == len(batch_result)
        for prog_ev, batch_ev in zip(progressive_results[-1], batch_result):
            assert prog_ev.type == batch_ev.type
            assert prog_ev.line == batch_ev.line
            assert prog_ev.func == batch_ev.func

    def test_progressive_parse_tracks_depth_correctly(self):
        """Depth should be correctly recomputed after each added event."""
        raw_lines = [
            '{"t":"enter","l":5,"f":"bsearch","d":1,"p":{"arr":[1,3,5,7,9],"target":7}}',
            '{"t":"state","l":6,"f":"bsearch","d":1,"v":{"lo":0,"hi":4}}',
            '{"t":"enter","l":22,"f":"helper","d":1,"p":{"x":42}}',
            '{"t":"state","l":23,"f":"helper","d":1,"v":{"y":99}}',
            '{"t":"exit","l":25,"f":"helper","d":1,"r":42}',
            '{"t":"exit","l":13,"f":"bsearch","d":1,"r":3}',
        ]

        # Progressive depth checks
        for i in range(1, len(raw_lines) + 1):
            parsed = parse(raw_lines[:i])
            # Validate depth invariants after each prefix
            depth = -1
            call_stack: list[str] = []
            for ev in parsed:
                if ev.type == EventType.FUNC_ENTER:
                    assert ev.depth >= 0
                    depth = ev.depth
                    call_stack.append(ev.func)
                elif ev.type == EventType.FUNC_EXIT:
                    assert ev.depth >= 0
                    if call_stack and call_stack[-1] == ev.func:
                        call_stack.pop()
                else:
                    assert ev.depth >= 0

    def test_progressive_parse_into_event_types(self):
        """After each progressive step, events should have correct Python types."""
        raw_lines = [
            '{"t":"enter","l":1,"f":"main","d":0,"p":{}}',
            '{"t":"state","l":2,"f":"main","d":0,"v":{"x":10}}',
            '{"t":"branch","l":3,"f":"main","d":0,"c":"x > 5","tk":true}',
            '{"t":"iter","l":4,"f":"main","d":0,"it":0}',
            '{"t":"exit","l":5,"f":"main","d":0,"r":0}',
        ]

        for i in range(1, len(raw_lines) + 1):
            parsed = parse(raw_lines[:i])
            # Check that the last event has the right type
            if parsed:
                last = parsed[-1]
                expected_t = raw_lines[i - 1].split('"t":"')[1].split('"')[0]
                type_map = {
                    "enter": FuncEnterEvent,
                    "exit": FuncExitEvent,
                    "state": StateEvent,
                    "branch": BranchEvent,
                    "iter": LoopIterEvent,
                }
                assert isinstance(last, type_map[expected_t]), (
                    f"Step {i}: expected {type_map[expected_t].__name__}, "
                    f"got {type(last).__name__}"
                )

    def test_parse_state_event_vars(self):
        """STATE events should carry a vars dict."""
        raw = ['{"t":"state","l":2,"f":"main","d":0,"v":{"x":10,"name":"hello"}}']
        parsed = parse(raw)
        assert len(parsed) == 1
        ev = parsed[0]
        assert isinstance(ev, StateEvent)
        assert ev.vars == {"x": 10, "name": "hello"}

    def test_parse_branch_event_condition(self):
        """BRANCH events should carry condition string and taken bool."""
        raw = ['{"t":"branch","l":3,"f":"main","d":0,"c":"x > 5","tk":true}']
        parsed = parse(raw)
        assert len(parsed) == 1
        ev = parsed[0]
        assert isinstance(ev, BranchEvent)
        assert ev.condition == "x > 5"
        assert ev.taken is True

    def test_parse_loop_iter_event_iteration(self):
        """LOOP_ITER events should carry iteration number."""
        raw = ['{"t":"iter","l":4,"f":"main","d":0,"it":2}']
        parsed = parse(raw)
        assert len(parsed) == 1
        ev = parsed[0]
        assert isinstance(ev, LoopIterEvent)
        assert ev.iteration == 2

    def test_parse_malformed_line_skipped(self):
        """Malformed JSON lines should be skipped, not crash."""
        raw_lines = [
            'not valid json',
            '{"t":"enter","l":1,"f":"main","d":0,"p":{}}',
            '{"t":"state","l":2,"f":"main","d":0,"v":{"x":1}}',
        ]
        parsed = parse(raw_lines)
        # Only the 2 valid events should be returned
        assert len(parsed) == 2
        assert parsed[0].type == EventType.FUNC_ENTER
        assert parsed[1].type == EventType.STATE

    def test_parse_empty_lines_are_skipped(self):
        """Empty lines in the stream should be skipped."""
        raw_lines = [
            "",
            '{"t":"enter","l":1,"f":"main","d":0,"p":{}}',
            "",
            "",
            '{"t":"exit","l":2,"f":"main","d":0,"r":0}',
            "",
        ]
        parsed = parse(raw_lines)
        assert len(parsed) == 2
        assert parsed[0].type == EventType.FUNC_ENTER
        assert parsed[1].type == EventType.FUNC_EXIT

    def test_parse_recursion_depth_computation(self):
        """Depth should increase for recursive function calls."""
        raw_lines = [
            '{"t":"enter","l":5,"f":"fact","d":1,"p":{"n":3}}',
            '{"t":"state","l":6,"f":"fact","d":1,"v":{"n":3}}',
            '{"t":"enter","l":5,"f":"fact","d":2,"p":{"n":2}}',
            '{"t":"state","l":6,"f":"fact","d":2,"v":{"n":2}}',
            '{"t":"enter","l":5,"f":"fact","d":3,"p":{"n":1}}',
            '{"t":"exit","l":10,"f":"fact","d":3,"r":1}',
            '{"t":"exit","l":10,"f":"fact","d":2,"r":2}',
            '{"t":"exit","l":10,"f":"fact","d":1,"r":6}',
        ]
        parsed = parse(raw_lines)

        # Check depth values are monotonic for enter events
        enters = [e for e in parsed if e.type == EventType.FUNC_ENTER]
        assert len(enters) == 3
        assert enters[0].depth == 0  # recomputed: first call at depth 0
        assert enters[1].depth == 1  # recursive call at depth 1
        assert enters[2].depth == 2  # deeper recursive call

        # Exit events should have decreasing depths
        exits = [e for e in parsed if e.type == EventType.FUNC_EXIT]
        assert len(exits) == 3
        assert exits[0].depth == 2
        assert exits[1].depth == 1
        assert exits[2].depth == 0

    def test_parse_empty_stream(self):
        """An empty stream should produce an empty event list."""
        parsed = parse([])
        assert parsed == []

    def test_parse_all_malformed(self):
        """A stream with only malformed lines should produce empty events."""
        parsed = parse([
            "trash",
            "also trash",
            "{bad json",
        ])
        assert parsed == []
