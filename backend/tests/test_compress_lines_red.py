"""P1-09 RED: _compress_state_events must not merge across (line, func).

Audit proof: l=5 + l=9 with identical vars merged into l=5 group_count=2.
Post-fix: no group spans lines; same-line runs still group (payload savings).
"""

import json

from app.core.trace.parser import parse as parse_trace


def _state(line: int, func: str = "main", vars_: dict | None = None) -> str:
    return json.dumps({"t": "state", "l": line, "f": func, "d": 0, "v": vars_ or {"x": 1}})


def _group_count(event) -> int | None:
    extra = getattr(event, "__pydantic_extra__", None) or {}
    if isinstance(extra, dict):
        return extra.get("group_count")
    return getattr(event, "group_count", None)


def test_multi_line_same_vars_not_merged():
    raw = [_state(5), _state(9)]
    events = parse_trace(raw, compressed=True)
    assert len(events) == 2, f"l=5 + l=9 merged: {[e.model_dump(by_alias=False) for e in events]}"
    assert [e.line for e in events] == [5, 9]
    for e in events:
        assert _group_count(e) is None, f"cross-line group formed: {e.model_dump(by_alias=False)}"


def test_multi_line_run_keeps_every_line():
    raw = [_state(5), _state(6), _state(7)]
    events = parse_trace(raw, compressed=True)
    assert [e.line for e in events] == [5, 6, 7]


def test_func_change_breaks_group():
    raw = [_state(5, "main"), _state(5, "foo")]
    events = parse_trace(raw, compressed=True)
    assert len(events) == 2


def test_same_line_run_still_groups():
    raw = [_state(5), _state(5), _state(5)]
    events = parse_trace(raw, compressed=True)
    assert len(events) == 1
    assert _group_count(events[0]) == 3
    assert _group_count(events[0]) is not None and _group_count(events[0]) > 1
