"""
trace/descriptions.py — Pure per-step explanation synthesis (``step_desc``).

One function, no I/O, no runtime dependency on any schema doc: given a
parsed trace event, return a short, human-readable, one-line description
for the frontend header + scrubber label (consumed by todo 8).

Formats (examples from docs/trace-schema-v2.md):
    enter:  "call solve(n=5)" / "call main()"
    state:  "assign x = 2"
    branch: "branch taken: x > 0" (+ " (x=2, 0)" when operand values exist)
    iter:   "iter 3 at line 7"
    exit:   "return 15" / "return from main" (no value)

Gotcha: unknown event types (or garbage input) yield a generic fallback
string — this function never raises, so parse() stays total.
"""

from __future__ import annotations

import json
from typing import Any

_MAX_VALUE_CHARS = 32
_MAX_DESC_CHARS = 120


def _fmt(value: Any) -> str:
    """Short one-line rendering of a traced value (str bare, rest JSON)."""
    if isinstance(value, str):
        text = value
    else:
        try:
            text = json.dumps(value, default=str)
        except (TypeError, ValueError):
            text = str(value)
    text = text.replace("\n", " ")
    return text if len(text) <= _MAX_VALUE_CHARS else text[:_MAX_VALUE_CHARS] + "…"


def describe(event: Any) -> str:
    """Synthesize the one-line ``step_desc`` for a trace event.

    Args:
        event: A parsed TraceEvent (or anything — garbage yields fallback).

    Returns:
        Short single-line description; never raises.
    """
    try:
        return _describe(event)
    except Exception:  # noqa: BLE001 — never-raise contract: garbage yields fallback
        return "unknown step"


def _describe(event: Any) -> str:
    line = getattr(event, "line", "?")
    func = getattr(event, "func", "?")
    raw_type = getattr(event, "type", None)
    kind = raw_type.value if hasattr(raw_type, "value") else raw_type

    if kind == "enter":
        params = getattr(event, "params", None) or {}
        args = ", ".join(f"{k}={_fmt(v)}" for k, v in params.items())
        return _clip(f"call {func}({args})")
    if kind == "state":
        items = getattr(event, "vars", None) or {}
        if not items:
            return _clip(f"line {line} in {func}")
        assigns = ", ".join(f"{k} = {_fmt(v)}" for k, v in items.items())
        return _clip(f"assign {assigns}")
    if kind == "branch":
        taken = "taken" if getattr(event, "taken", False) else "not taken"
        desc = f"branch {taken}: {getattr(event, 'condition', '?')}"
        ops = getattr(event, "ops", None) or []
        if ops:
            desc += f" ({', '.join(str(o) for o in ops)})"
        return _clip(desc)
    if kind == "iter":
        return _clip(f"iter {getattr(event, 'iteration', '?')} at line {line}")
    if kind == "exit":
        ret = getattr(event, "return_val", None)
        if ret is None:
            return _clip(f"return from {func}")
        return _clip(f"return {_fmt(ret)}")
    if line == "?" and func == "?":
        return "unknown step"
    return f"step at line {line} in {func}"


def _clip(text: str) -> str:
    """Keep the description to one short line."""
    text = text.replace("\n", " ")
    return text if len(text) <= _MAX_DESC_CHARS else text[:_MAX_DESC_CHARS] + "…"
