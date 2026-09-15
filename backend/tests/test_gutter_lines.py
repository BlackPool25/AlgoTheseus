"""test_gutter_lines.py — F3: live traces carry prev_line/return_line.

Live tracer (tracer.h) never emits pl/rl — the parser must synthesize them
so the two-arrow Monaco gutter renders on REAL traces, not just mocks.
"""

from __future__ import annotations

import json

from app.core.trace.parser import parse


def _raw(events: list[dict]) -> list[str]:
    return [json.dumps(ev) for ev in events]


# Live shape: short keys, no "pl"/"rl" anywhere (exactly what tracer.h emits).
LIVE_NESTED = [
    {"t": "enter", "l": 1, "f": "main", "d": 0, "p": {}},
    {"t": "state", "l": 2, "f": "main", "d": 0, "v": {"x": 1}},
    {"t": "enter", "l": 3, "f": "helper", "d": 0, "p": {"n": 5}},
    {"t": "state", "l": 4, "f": "helper", "d": 0, "v": {"y": 10}},
    {"t": "state", "l": 5, "f": "helper", "d": 0, "v": {"y": 11}},
    {"t": "exit", "l": 5, "f": "helper", "d": 0, "r": 11},
    {"t": "exit", "l": 6, "f": "main", "d": 0, "r": 0},
]


def test_live_stream_synthesizes_prev_line_per_state():
    events = parse(_raw(LIVE_NESTED))
    states = [e for e in events if e.type.value == "state"]
    assert len(states) == 3
    for s in states:
        assert s.prev_line is not None, f"state@{s.line} missing prev_line"
    assert states[0].prev_line == 1
    assert states[1].prev_line == 3
    assert states[2].prev_line == 4


def test_live_stream_synthesizes_return_line_on_nested_exit():
    events = parse(_raw(LIVE_NESTED))
    exits = [e for e in events if e.type.value == "exit"]
    helper_exit = [e for e in exits if e.func == "helper"]
    assert len(helper_exit) == 1
    assert helper_exit[0].return_line == 3
