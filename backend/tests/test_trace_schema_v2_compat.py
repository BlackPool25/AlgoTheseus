"""
test_trace_schema_v2_compat.py — Regression: v1 traces (no v2 fields) keep working.

Schema-v2 is additive-only: every new field is optional. An old fixture that
carries NONE of the new fields must parse with zero exceptions and compress
to a flat (ungrouped) fallback. Malformed/unknown fields must be skipped or
tolerated, never raise.
"""

from __future__ import annotations

import json

from app.core.trace import models
from app.core.trace.parser import parse


# ── Old v1 fixture: no v2 fields anywhere ─────────────────────────────────────

OLD_FIXTURE_LINES = [
    json.dumps({"t": "enter", "l": 1, "f": "main", "d": 0, "p": {}}),
    json.dumps({"t": "state", "l": 2, "f": "main", "d": 0, "v": {"x": 1}}),
    json.dumps({"t": "branch", "l": 3, "f": "main", "d": 0, "c": "x > 0", "tk": True}),
    json.dumps({"t": "iter", "l": 4, "f": "main", "d": 0, "it": 0}),
    json.dumps({"t": "state", "l": 5, "f": "main", "d": 0, "v": {"x": 2}}),
    json.dumps({"t": "exit", "l": 6, "f": "main", "d": 0, "r": 0}),
]


class TestOldFixtureParses:
    def test_old_fixture_parses_with_no_crash(self):
        """Given old v1 lines / When parsed / Then all 6 events returned."""
        events = parse(OLD_FIXTURE_LINES)
        assert len(events) == 6

    def test_old_fixture_event_types(self):
        """Given old v1 lines / When parsed / Then discriminant types match."""
        events = parse(OLD_FIXTURE_LINES)
        assert [e.type.value for e in events] == [
            "enter", "state", "branch", "iter", "state", "exit",
        ]

    def test_old_fixture_renders_flat_fallback(self):
        """Given distinct STATE vars / When compressed / Then no groups (flat)."""
        events = parse(OLD_FIXTURE_LINES, compressed=True)
        assert len(events) == 6  # nothing collapsed → flat fallback
        assert all(
            e.__pydantic_extra__.get("group_count", 1) == 1 for e in events
        )


class TestV2OptionalFields:
    """Every v2 field must exist on the models and default to None/absent."""

    def test_state_event_has_v2_fields(self):
        assert isinstance(models.StateEvent.model_fields.get("stdout"), object)
        e = models.StateEvent.model_validate(
            {"t": "state", "l": 1, "f": "main", "d": 0, "v": {}}
        )
        assert e.stdout is None
        assert e.globals is None
        assert e.step_desc is None
        assert e.prev_line is None
        assert e.stdout_truncated is False

    def test_branch_event_has_v2_fields(self):
        e = models.BranchEvent.model_validate(
            {"t": "branch", "l": 1, "f": "main", "d": 0, "c": "x", "tk": True}
        )
        assert e.ops is None
        assert e.step_desc is None

    def test_enter_event_has_step_desc(self):
        e = models.FuncEnterEvent.model_validate(
            {"t": "enter", "l": 1, "f": "main", "d": 0, "p": {}}
        )
        assert e.step_desc is None

    def test_exit_event_has_v2_fields(self):
        e = models.FuncExitEvent.model_validate(
            {"t": "exit", "l": 1, "f": "main", "d": 0, "r": 0}
        )
        assert e.step_desc is None
        assert e.return_line is None

    def test_new_fields_accepted_when_present(self):
        e = models.StateEvent.model_validate(
            {
                "t": "state", "l": 1, "f": "main", "d": 0, "v": {"x": 1},
                "stdout": "hi\n", "stdout_truncated": False,
                "globals": {"g": 1}, "step_desc": "assign x",
                "prev_line": 1, "heap": {"1": [1, 2]},
            }
        )
        assert e.stdout == "hi\n"
        assert e.step_desc == "assign x"
        assert e.heap == {"1": [1, 2]}


class TestAdversarial:
    def test_garbage_and_unknown_fields_never_raise(self):
        """Given malformed/unknown-field lines / When parsed / Then skipped, no raise."""
        lines = [
            "not json at all{{{",
            json.dumps({"t": "state", "l": 1}),  # missing required f/d → invalid
            json.dumps(
                {"t": "state", "l": 1, "f": "m", "d": 0, "v": {},
                 "some_future_field": 123}
            ),
            json.dumps({"t": "state", "l": 2, "f": "m", "d": 0, "v": {"a": 1}}),
        ]
        events = parse(lines)
        assert len(events) == 2  # only the two valid events survive
