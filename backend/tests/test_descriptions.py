"""
test_descriptions.py — Table-driven tests for parser-synthesized step_desc.

Every NDJSON stream event carries a short, human-readable, one-line
``step_desc`` (v2 ``sd`` alias). Formats mirror docs/trace-schema-v2.md
examples: enter/state/branch-with-ops/iter/exit.

TDD RED: this file was written BEFORE backend/app/core/trace/descriptions.py
existed, so it initially fails at collection (ModuleNotFoundError).
"""

from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any

import pytest

from app.core.trace.descriptions import describe
from app.core.trace.parser import parse


def _ev(payload: dict[str, Any]) -> Any:
    """Build a wire-shaped dict into a typed event via parse (single line)."""
    events = parse([json.dumps(payload)])
    assert len(events) == 1
    return events[0]


# ── Table-driven format cases ─────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("payload", "expected"),
    [
        # enter: call func(params)
        (
            {"t": "enter", "l": 12, "f": "solve", "d": 1, "p": {"n": 5}},
            "call solve(n=5)",
        ),
        (
            {"t": "enter", "l": 1, "f": "main", "d": 0, "p": {}},
            "call main()",
        ),
        # state: assign k = v
        (
            {"t": "state", "l": 14, "f": "solve", "d": 1, "v": {"x": 2}},
            "assign x = 2",
        ),
        # exit: return <val>
        (
            {"t": "exit", "l": 20, "f": "solve", "d": 1, "r": 15},
            "return 15",
        ),
        # branch without ops
        (
            {"t": "branch", "l": 16, "f": "solve", "d": 1,
             "c": "i < n", "tk": True},
            "branch taken: i < n",
        ),
        (
            {"t": "branch", "l": 16, "f": "solve", "d": 1,
             "c": "x > 0", "tk": False},
            "branch not taken: x > 0",
        ),
        # iter
        (
            {"t": "iter", "l": 7, "f": "solve", "d": 1, "it": 3},
            "iter 3 at line 7",
        ),
    ],
)
def test_desc_formats(payload: dict[str, Any], expected: str):
    """Given a wire event / When described / Then exact one-line format."""
    assert describe(_ev(payload)) == expected


def test_desc_branch_with_ops():
    """Given a BRANCH with operand values / When described / Then ops shown."""
    event = _ev(
        {"t": "branch", "l": 16, "f": "solve", "d": 1,
         "c": "x > 0", "tk": True, "op": ["x=2", "0"]}
    )
    assert describe(event) == "branch taken: x > 0 (x=2, 0)"


def test_desc_unknown_type_falls_back_never_raises():
    """Given an unknown event type / When described / Then fallback, no raise."""
    probe = SimpleNamespace(type="mystery", line=9, func="solve")
    result = describe(probe)
    assert isinstance(result, str) and result != ""
    assert "line 9" in result


def test_desc_garbage_object_never_raises():
    """Given a non-event object / When described / Then generic string."""
    assert isinstance(describe(object()), str)


# ── parse() wiring ────────────────────────────────────────────────────────────


def test_parse_attaches_non_empty_step_desc_to_every_event():
    """Given a mixed NDJSON stream / When parsed / Then every event has desc."""
    raw = [
        json.dumps({"t": "enter", "l": 5, "f": "bsearch", "d": 0,
                    "p": {"target": 7}}),
        json.dumps({"t": "state", "l": 6, "f": "bsearch", "d": 0,
                    "v": {"lo": 0, "hi": 4}}),
        json.dumps({"t": "branch", "l": 9, "f": "bsearch", "d": 0,
                    "c": "arr[mid] == target", "tk": False}),
        json.dumps({"t": "iter", "l": 7, "f": "bsearch", "d": 0, "it": 0}),
        json.dumps({"t": "exit", "l": 13, "f": "bsearch", "d": 0, "r": 3}),
    ]
    events = parse(raw)
    assert len(events) == 5
    for ev in events:
        desc = getattr(ev, "step_desc", None) or ev.__pydantic_extra__.get("step_desc")
        assert isinstance(desc, str) and desc != "" and "\n" not in desc
    # iter (no declared field) must still serialize step_desc via extras
    dumped = [e.model_dump(by_alias=False) for e in events]
    assert all(isinstance(d.get("step_desc"), str) and d["step_desc"] for d in dumped)
