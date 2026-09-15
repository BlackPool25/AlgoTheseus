"""
test_heap_table.py — Acceptance tests for T11b parser heap table (todo 16).

RED-first: imports heap_at_step/heap_diff/heap_changes from
app.core.trace.parser, which do not exist until the implementation lands.

Wire shape locked by todo 15 + docs/serializer-design.md:
  struct value  {"$id": int, "$addr": "0x...", fields...}
  pointer       {"$ref": id} / full object (first sighting) / null
  cycle         {"$ref": id, "$cycle": true}
  vector-of-struct {"$id", "$addr", "items": [...]}  (vector<int> stays bare [...])

Per-step heap table: {id -> {"type", "fields", "refs"}} with
current-step-only $ref resolution (dangling $ref -> "unknown", never raises).
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from pathlib import Path

from app.core.trace.parser import heap_at_step, heap_changes, heap_diff, parse

TRACER_H = Path(__file__).parent.parent / "app" / "core" / "instrumenter" / "tracer.h"
FIXTURES = Path(__file__).parent / "fixtures"


def _raw(events: list[dict]) -> list[str]:
    return [json.dumps(ev) for ev in events]


def _instrument_compile_run(fixture: str) -> list[dict]:
    """Instrument a fixture, compile, run, return raw TRACE dicts."""
    from app.core.instrumenter.injector import instrument

    src = (FIXTURES / fixture).read_text()
    instrumented = instrument(src, source_path=str(FIXTURES / fixture))
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        prog = tmp_path / "prog.cpp"
        prog.write_text(instrumented)
        shutil.copy(TRACER_H, tmp_path / "tracer.h")
        binary = tmp_path / "prog"
        compile_result = subprocess.run(
            ["g++", "-O0", "-std=c++17", "-I", str(tmp_path),
             "-o", str(binary), str(prog)],
            capture_output=True, text=True, timeout=30,
        )
        assert compile_result.returncode == 0, f"Compile error:\n{compile_result.stderr}"
        run = subprocess.run([str(binary)], capture_output=True, text=True, timeout=10)
    assert run.returncode == 0, f"nonzero exit:\n{run.stderr}"
    return [
        json.loads(line[len("TRACE:"):]) for line in run.stderr.splitlines()
        if line.startswith("TRACE:")
    ]


def _node(id_: int, val: int, left=None, right=None) -> dict:
    return {"$id": id_, "$addr": f"0x{id_:x}000", "val": val,
            "left": left, "right": right}


def test_heap_table_contains_structs():
    """Given instrumented linked_list fixture / When parsed /
    Then STATE heap tables hold {id -> {type, fields, refs}} with stable ids
    and in-step refs resolving to table ids."""
    trace_vals = _instrument_compile_run("linked_list.cpp")
    events = parse([json.dumps(e) for e in trace_vals])
    tables = heap_at_step(events)

    assert len(tables) == len(events)  # parallel array, 1:1 with events
    states = [(e, t) for e, t in zip(events, tables) if e.type.value == "state"]
    assert states, "expected STATE events"
    non_empty = [(e, t) for e, t in states if t]
    assert non_empty, "expected at least one STATE with a heap table"

    for event, table in non_empty:
        assert event.heap == table  # parse() attaches the same table
        for id_, entry in table.items():
            assert set(entry) >= {"type", "fields", "refs"}, entry
            for target in entry["refs"].values():
                if isinstance(target, list):  # container items
                    for item in target:
                        assert item == "unknown" or item in table, (id_, entry)
                else:
                    assert target == "unknown" or target in table, (id_, entry)

    # Live-fixture edge proof (Atlas QA): this fixture emits only full
    # in-step objects, so NO ref may dangle — every target is a table key.
    for _, table in non_empty:
        for id_, entry in table.items():
            for target in entry["refs"].values():
                targets = target if isinstance(target, list) else [target]
                for t in targets:
                    assert t in table, (id_, entry)  # never "unknown" here

    # Stable ids: some $id survives across consecutive STATEs.
    ids_per_state = [set(t) for _, t in states if t]
    assert any(a & b for a, b in zip(ids_per_state, ids_per_state[1:])), (
        "no stable $id across consecutive steps"
    )


def test_in_step_ref_resolves_to_child_key():
    """Given a parent with a PRESENT child id / When extracted /
    Then the ref equals the child's (string) table key — never "unknown"."""
    lines = _raw([
        {"t": "state", "l": 1, "f": "main", "d": 0,
         "v": {"root": _node(1, 1, left=_node(2, 2), right=None),
               "alias": {"$ref": 1}}},
    ])
    events = parse(lines)
    table = heap_at_step(events)[0]
    assert set(table) == {"1", "2"}
    assert table["1"]["refs"]["left"] == "2"
    assert isinstance(table["1"]["refs"]["left"], str)
    assert table["1"]["fields"]["right"] is None  # null stays a scalar field


def test_heap_dedup_same_object_across_steps():
    """Given two STATEs with a byte-identical $id object / When parsed /
    Then the entry object is shared (is-identical), not duplicated."""
    lines = _raw([
        {"t": "enter", "l": 1, "f": "main", "d": 0, "p": {}},
        {"t": "state", "l": 2, "f": "main", "d": 0,
         "v": {"x": 1, "root": _node(1, 1)}},
        {"t": "state", "l": 3, "f": "main", "d": 0,
         "v": {"x": 2, "root": _node(1, 1)}},
        {"t": "exit", "l": 4, "f": "main", "d": 0, "r": 0},
    ])
    events = parse(lines)
    tables = heap_at_step(events)

    assert tables[1] and tables[2], "both STATEs must have heap tables"
    assert set(tables[1]) == {"1"} and set(tables[2]) == {"1"}
    assert tables[2]["1"] is tables[1]["1"], "unchanged $id must share storage"
    assert events[2].heap["1"] is events[1].heap["1"]


def test_mutation_detected_by_id():
    """Given same $id with one changed field / When diffed /
    Then mutated=[id] with exactly that field in changed_fields."""
    lines = _raw([
        {"t": "enter", "l": 1, "f": "main", "d": 0, "p": {}},
        {"t": "state", "l": 2, "f": "main", "d": 0,
         "v": {"root": _node(1, 1, left=_node(2, 2))}},
        {"t": "state", "l": 3, "f": "main", "d": 0,
         "v": {"root": _node(1, 42, left=_node(2, 2))}},
        {"t": "exit", "l": 4, "f": "main", "d": 0, "r": 0},
    ])
    events = parse(lines)
    tables = heap_at_step(events)

    assert tables[2]["1"] is not tables[1]["1"], "mutated entry must be fresh"
    assert tables[2]["2"] is tables[1]["2"], "untouched child still shared"

    diff = heap_diff(tables[1], tables[2])
    assert diff["mutated"] == ["1"]
    assert diff["changed_fields"] == {"1": ["val"]}
    assert diff["added"] == [] and diff["removed"] == []

    changes = heap_changes(events)
    assert len(changes) == len(events)
    assert changes[2]["mutated"] == ["1"]
    assert events[2].heap_diff["mutated"] == ["1"]  # exposed for HeapPanel
    assert events[1].heap_diff["added"] == ["1", "2"]  # first sighting = added


def test_zero_id_trace_yields_empty_heap():
    """Given struct-less simple_bsearch fixture / When parsed /
    Then every heap table is empty, heap/heap_diff stay None (wire-identical
    to before), and scalar vars still flow through the old path."""
    trace_vals = _instrument_compile_run("simple_bsearch.cpp")
    events = parse([json.dumps(e) for e in trace_vals])
    tables = heap_at_step(events)

    states = [e for e in events if e.type.value == "state"]
    assert states, "expected STATE events"
    assert all(t == {} for e, t in zip(events, tables)
               if e.type.value == "state")
    assert all(e.heap is None for e in states), "no new wire key on $id-less traces"
    assert all(e.heap_diff is None for e in states)
    assert any(e.vars for e in states), "scalar vars still carried (old path)"
    assert heap_diff({}, {}) == {
        "added": [], "removed": [], "mutated": [], "changed_fields": {},
    }


def test_dangling_ref_renders_unknown_never_raises():
    """Given a $ref to an id absent from this step / When extracted /
    Then the ref renders as 'unknown' instead of raising."""
    lines = _raw([
        {"t": "state", "l": 1, "f": "main", "d": 0,
         "v": {"root": {"$id": 1, "$addr": "0x1",
                        "val": 1, "next": {"$ref": 99}}}},
        {"t": "state", "l": 2, "f": "main", "d": 0, "v": {"x": "garbage"}},
    ])
    events = parse(lines)  # must not raise (parse stays total)
    tables = heap_at_step(events)
    assert tables[0]["1"]["refs"] == {"next": "unknown"}
