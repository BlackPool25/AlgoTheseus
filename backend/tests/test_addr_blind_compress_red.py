"""test_addr_blind_compress_red.py — Task 7: $addr-blind state compression.

RED-first: consecutive STATE events whose vars/heap differ ONLY in `$addr`
(ASLR changes addresses every run) must compress into one group, while
genuinely different states (different `$id` / `refs`) must still split.

Wire shape (locked by serializer contract):
  struct value  {"$id": int, "$addr": "0x...", fields...}
  pointer       {"$ref": id}
Heap tables attach per step as {id -> {"type", "fields", "refs", "addr"}}.

`$addr` must survive in payloads (HeapPanel displays it) — only the
compression *compare key* is address-blind.
"""

from __future__ import annotations

import json

import pytest

from app.core.trace.parser import parse as parse_trace


def _raw(events: list[dict]) -> list[str]:
    return [json.dumps(ev) for ev in events]


def _node(id_: int, addr: str, val: int, extra: dict | None = None) -> dict:
    node: dict = {"$id": id_, "$addr": addr, "val": val}
    if extra:
        node.update(extra)
    return node


def _vars(addr_root: str, addr_child: str) -> dict:
    return {
        "x": 7,
        "root": _node(1, addr_root, 1, {"left": _node(2, addr_child, 2)}),
    }


def _state(line: int, vars_: dict, func: str = "main") -> dict:
    return {"t": "state", "l": line, "f": func, "d": 0, "v": vars_}


def _group_count(event) -> int | None:
    extra = getattr(event, "__pydantic_extra__", None) or {}
    if isinstance(extra, dict):
        return extra.get("group_count")
    return getattr(event, "group_count", None)


# Flaky/addr-randomness probe: three distinct addr pairs must ALL merge.
@pytest.mark.parametrize(
    "addrs_a,addrs_b",
    [
        (("0x1", "0x2"), ("0x3", "0x4")),  # tiny addrs
        (
            ("0x7f3a9c001010", "0x7f3a9c001040"),
            ("0x55b1e2002a40", "0x55b1e2002a70"),
        ),  # ASLR-like bases
        (("0x0", "0x0"), ("0x00000000", "0x00")),  # zero addrs, distinct spellings
    ],
)
def test_diff_addr_pair_must_merge(addrs_a, addrs_b):
    """Given two STATEs identical except `$addr` / When compressed /
    Then they merge into one group (observable: event count 1)."""
    raw = _raw([_state(5, _vars(*addrs_a)), _state(5, _vars(*addrs_b))])
    events = parse_trace(raw, compressed=True)
    assert len(events) == 1, (
        f"diff-addr pair split: {[e.model_dump(by_alias=False) for e in events]}"
    )
    assert _group_count(events[0]) == 2


def test_merged_payload_keeps_addr_for_display():
    """Given a diff-addr pair that merges / When compressed /
    Then the surviving payload still carries `$addr` (HeapPanel display)."""
    raw = _raw([_state(5, _vars("0xaaa", "0xbbb")), _state(5, _vars("0xccc", "0xddd"))])
    events = parse_trace(raw, compressed=True)
    assert len(events) == 1
    assert events[0].vars["root"]["$addr"] == "0xaaa"  # first event wins
    assert events[0].vars["root"]["left"]["$addr"] == "0xbbb"
    assert events[0].heap is not None
    assert events[0].heap["1"]["addr"] == "0xaaa"
    assert events[0].heap["2"]["addr"] == "0xbbb"


def test_different_id_must_not_merge():
    """Given same fields but different `$id` / When compressed /
    Then the compare key preserves `$id`: states split (observable: count 2)."""
    raw = _raw(
        [
            _state(5, {"x": 7, "root": _node(1, "0xaaa", 1)}),
            _state(5, {"x": 7, "root": _node(2, "0xaaa", 1)}),
        ]
    )
    events = parse_trace(raw, compressed=True)
    assert len(events) == 2, "over-merge: different $id merged"
    assert all(_group_count(e) is None for e in events)


def test_different_refs_must_not_merge():
    """Given same `$id`s but different `refs` targets / When compressed /
    Then the compare key preserves `refs`: states split (observable: count 2)."""
    raw = _raw(
        [
            _state(
                5,
                {
                    "root": _node(1, "0xaaa", 1, {"next": {"$ref": 2}}),
                    "other": _node(2, "0xbbb", 2),
                },
            ),
            _state(
                5,
                {
                    "root": _node(1, "0xaaa", 1, {"next": {"$ref": 99}}),
                    "other": _node(2, "0xbbb", 2),
                },
            ),
        ]
    )
    events = parse_trace(raw, compressed=True)
    assert len(events) == 2, "over-merge: different refs merged"
    assert all(_group_count(e) is None for e in events)


def test_id_less_pair_documents_current_behavior():
    """Given `$id`-less traces / When compressed / Then identical pairs merge
    and differing pairs split — documenting current behavior unchanged."""
    same = _raw([_state(5, {"x": 1}), _state(5, {"x": 1})])
    assert len(parse_trace(same, compressed=True)) == 1

    different = _raw([_state(5, {"x": 1}), _state(5, {"x": 2})])
    assert len(parse_trace(different, compressed=True)) == 2
