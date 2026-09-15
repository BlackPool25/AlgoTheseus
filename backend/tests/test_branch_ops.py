"""
test_branch_ops.py — T8 branch operand values (RED-first).

Branch `arr[mid]==target` must carry operand keys arr,mid,target with values;
streaming parse must match values; unserializable pointers yield a capped
placeholder, never a crash.
"""

from __future__ import annotations

import json
from pathlib import Path

from app.core.instrumenter.ast_walker import InjectKind, walk
from app.core.instrumenter.injector import instrument
from app.core.trace.descriptions import describe
from app.core.trace.parser import parse

FIXTURES = Path(__file__).parent / "fixtures"
BSEARCH = str(FIXTURES / "simple_bsearch.cpp")


def test_branch_ops_vars_collected():
    """Given `arr[mid]==target` / When walked / Then keys arr,mid,target."""
    result = walk(BSEARCH)
    branches = [
        p for p in result.injection_points
        if p.kind == InjectKind.BRANCH and "arr[mid]" in p.condition_text
    ]
    assert branches, "expected a BRANCH for arr[mid]==target"
    ops_vars = branches[0].cond_vars
    assert set(ops_vars) == {"arr", "mid", "target"}


def test_branch_ops_emitted_in_instrumented_source():
    """Given the fixture / When instrumented / Then BRANCH carries ops args."""
    src = Path(BSEARCH).read_text(encoding="utf-8")
    out = instrument(src, BSEARCH)
    assert "__TRACE_BRANCH_OPS" in out
    assert '"arr", arr' in out and '"mid", mid' in out and '"target", target' in out


def test_branch_ops_streaming_values_match():
    """Given branch wire JSON with op / When parsed / Then values match."""
    raw = [json.dumps({"t": "branch", "l": 9, "f": "bsearch", "d": 0,
                       "c": "arr[mid] == target", "tk": False,
                       "op": ["arr=[1,3,5,7,9]", "mid=2", "target=7"]})]
    events = parse(raw)
    assert len(events) == 1
    assert events[0].ops == ["arr=[1,3,5,7,9]", "mid=2", "target=7"]
    assert describe(events[0]) == (
        "branch not taken: arr[mid] == target (arr=[1,3,5,7,9], mid=2, target=7)"
    )
