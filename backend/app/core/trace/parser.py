"""
trace/parser.py — Parses raw TRACE: lines into a typed TraceEvent list.

Input: list of raw JSON strings (TRACE: prefix already stripped by docker_runner).
Output: list[TraceEvent] in execution order.

The index of an event in this list is its "step number" — used everywhere
else in the system to synchronise the scrubber, CFG, and state panel.

Gotcha: The LLM or user code might produce malformed JSON. We skip bad lines
and log a warning rather than crashing — partial traces are better than none.

Gotcha: Pydantic v2 discriminated unions require model_validate with the
raw dict, not model_validate_json, because we need to handle the alias mapping.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from pydantic import TypeAdapter, ValidationError

from .descriptions import describe
from .models import (
    EventType,
    StackFrame,
    TraceEvent,
)

logger = logging.getLogger(__name__)

# TypeAdapter lets us validate a discriminated union without a wrapper model
_event_adapter: TypeAdapter[TraceEvent] = TypeAdapter(TraceEvent)  # type: ignore[type-arg]

# T7 adaptive cumulative stdout (engine-agnostic "o" protocol — see
# docs/trace-schema-v2.md): the tracer (Docker-local now, WASM shim later)
# emits "o" = bytes printed since the previous event. The parser accumulates
# those transport deltas into cumulative per-STATE stdout. No engine
# specifics here — only the "o" field contract.
_STDOUT_CAP_BYTES = 65536  # 64 KB per-event cap, UTF-8 code-point safe
_ADAPTIVE_STEP_THRESHOLD = 2000  # >2000 steps: stdout on loop-boundary STATEs only


def parse(raw_lines: list[str], compressed: bool = False) -> list[Any]:
    """Parse raw TRACE: JSON lines into a list of typed TraceEvent objects.

    Args:
        raw_lines: List of JSON strings (TRACE: prefix already stripped).
                   Each string should be a valid JSON object.
        compressed: When True, collapse consecutive STATE events with identical
                    ``vars`` dicts into a single event carrying ``group_start``,
                    ``group_end``, ``group_count``, and ``compressed=True``
                    metadata.

    Returns:
        List of TraceEvent objects in execution order.
        Malformed lines are skipped with a warning.
    """
    events: list[Any] = []
    deltas: list[str | None] = []  # parallel "o" transport deltas (None = v1 absent)

    for i, line in enumerate(raw_lines):
        line = line.strip()
        if not line:
            continue
        try:
            data = json.loads(line)
        except json.JSONDecodeError as e:
            logger.warning("Skipping malformed trace line %d: %s — %s", i, line[:80], e)
            continue

        try:
            event = _event_adapter.validate_python(data)
            events.append(event)
            o = data.get("o")
            deltas.append(o if isinstance(o, str) else None)
        except ValidationError as e:
            logger.warning("Skipping invalid trace event at line %d: %s — %s", i, data, e)
            continue

    # Recompute dynamic depth based on enter/exit events
    call_stack: list[str] = []
    for event in events:
        if event.type == EventType.FUNC_ENTER:
            event.depth = len(call_stack)
            call_stack.append(event.func)
        elif event.type == EventType.FUNC_EXIT:
            event.depth = len(call_stack) - 1 if call_stack else 0
            if call_stack and call_stack[-1] == event.func:
                call_stack.pop()
            elif event.func in call_stack:
                # Pop the nearest matching frame to keep stack consistent
                idx = len(call_stack) - 1 - call_stack[::-1].index(event.func)
                call_stack.pop(idx)
        else:
            event.depth = len(call_stack) - 1 if call_stack else 0

    # F3 two-arrow gutter: the live tracer (tracer.h) never emits pl/rl,
    # so synthesize them here — previous executed line per step, plus the
    # call-site line on nested function exits. Tracer-provided values win
    # (mocks/older shims may already carry them). Outermost exits keep
    # return_line None (no caller to map to); the frontend falls back to
    # the single highlight for those steps only.
    _apply_gutter_lines(events)

    # Accumulate "o" transport deltas into cumulative per-STATE stdout
    # (adaptive granularity + 64KB cap per docs/trace-schema-v2.md).
    _apply_incremental_stdout(events, deltas)

    # Synthesize per-step explanations (pure, never raises).
    for event in events:
        event.step_desc = describe(event)

    # T11b: per-step heap tables + per-$id change sets (pure, never raises).
    # Only STATE events with $id-bearing values (or an explicit "h" key)
    # gain heap/heap_diff; every other event keeps both as None so v1 and
    # $id-less traces stay wire-identical to before.
    _apply_heap_tables(events)

    if compressed:
        events = _compress_state_events(events)

    return events


def _apply_gutter_lines(events: list[Any]) -> None:
    enter_stack: list[tuple[str, int]] = []  # (func, enter line) per live frame
    prev: int | None = None  # previous executed line
    for event in events:
        if event.type == EventType.FUNC_ENTER:
            enter_stack.append((event.func, event.line))
        elif event.type == EventType.FUNC_EXIT:
            if event.return_line is None:
                idx = next(
                    (
                        i
                        for i in range(len(enter_stack) - 1, -1, -1)
                        if enter_stack[i][0] == event.func
                    ),
                    None,
                )
                if idx is not None and idx > 0:
                    event.return_line = enter_stack[idx][1]
            if enter_stack and enter_stack[-1][0] == event.func:
                enter_stack.pop()
            elif any(f == event.func for f, _ in enter_stack):
                cut = max(i for i, (f, _) in enumerate(enter_stack) if f == event.func)
                del enter_stack[cut:]
        elif event.type == EventType.STATE and event.prev_line is None:
            event.prev_line = prev
        prev = event.line


def frames_at_step(events: list[Any]) -> list[list[StackFrame]]:
    """Reconstruct the live call-stack at every step.

    Returns a parallel array (one entry per event): each entry is the list
    of live ``StackFrame`` snapshots *after* applying that step's event.
    Parent frames keep their vars untouched while a child runs; a child's
    FUNC_EXIT pops it (post-pop snapshot). An EXIT with no matching frame
    (e.g. a user ``exit()`` call) leaves the stack unchanged — never raises.
    """
    frames: list[list[StackFrame]] = []
    stack: list[StackFrame] = []
    next_id = 0

    for event in events:
        if event.type == EventType.FUNC_ENTER:
            stack.append(
                StackFrame(
                    func=event.func,
                    frame_id=next_id,
                    depth=len(stack),
                    vars=dict(getattr(event, "params", None) or {}),
                )
            )
            next_id += 1
        elif event.type == EventType.FUNC_EXIT:
            if stack and stack[-1].func == event.func:
                stack.pop()
            elif any(f.func == event.func for f in stack):
                # Truncate to the nearest matching frame (drop it and above).
                idx = max(i for i, f in enumerate(stack) if f.func == event.func)
                del stack[idx:]
            # else: unbalanced exit — leave the stack unchanged.
        elif event.type == EventType.STATE and stack:
            stack[-1].vars.update(event.vars or {})

        frames.append(
            [
                StackFrame(
                    func=f.func,
                    frame_id=f.frame_id,
                    depth=f.depth,
                    vars=dict(f.vars),
                )
                for f in stack
            ]
        )

    return frames


def stack_to_render(events: list[Any], step: int) -> list[StackFrame]:
    """Live frames to render at a single step (slice of ``frames_at_step``)."""
    return frames_at_step(events)[step]


def heap_at_step(events: list[Any]) -> list[dict[str, dict]]:
    """Per-step heap tables, parallel to ``events`` (one entry per event).

    Each STATE step maps ``str($id)`` to ``{"type", "fields", "refs",
    "addr"}`` extracted from that step's own ``vars`` (current-step-only:
    a ``$ref`` to an id absent from this step renders as ``"unknown"``,
    never raises). Non-STATE steps yield ``{}``. A STATE carrying an
    explicit ``heap`` (``"h"`` key) keeps it as-is.

    Unchanged ``$id`` entries share storage with the previous STATE's
    table (``cur[id] is prev[id]``), so long traces do not duplicate
    identical objects step after step. Never raises: garbage payloads
    yield ``{}`` for that step.
    """
    tables: list[dict[str, dict]] = []
    prev: dict[str, dict] = {}
    for event in events:
        if event.type != EventType.STATE:
            tables.append({})
            continue
        try:
            heap = event.heap
            base = dict(heap) if isinstance(heap, dict) else _extract_heap_table(event.vars)
        except Exception:  # noqa: BLE001 — parse stays total on garbage
            logger.warning("heap extraction failed; using empty table")
            base = {}
        cur = {k: prev[k] if k in prev and prev[k] == v else v for k, v in base.items()}
        tables.append(cur)
        prev = cur
    return tables


def heap_diff(prev: dict | None, cur: dict | None) -> dict[str, Any]:
    """Prev-vs-current per-``$id`` change set for the frontend HeapPanel.

    Returns ``{"added", "removed", "mutated", "changed_fields"}`` where
    ``changed_fields`` maps each mutated id to its changed field names.
    Generic over entry shapes (normalized or raw); never raises.
    """
    old = prev if isinstance(prev, dict) else {}
    new = cur if isinstance(cur, dict) else {}
    added = sorted((k for k in new if k not in old), key=_heap_id_key)
    removed = sorted((k for k in old if k not in new), key=_heap_id_key)
    mutated = sorted((k for k in new if k in old and old[k] != new[k]), key=_heap_id_key)
    return {
        "added": added,
        "removed": removed,
        "mutated": mutated,
        "changed_fields": {k: _changed_keys(old[k], new[k]) for k in mutated},
    }


def heap_changes(events: list[Any]) -> list[dict[str, Any]]:
    """Per-step ``heap_diff`` against the previous STATE's table.

    Parallel to ``events``; non-STATE steps yield an empty change set.
    The first STATE lists all its ids as added. Never raises.
    """
    tables = heap_at_step(events)
    out: list[dict[str, Any]] = []
    prev: dict[str, dict] = {}
    for event, table in zip(events, tables):
        if event.type == EventType.STATE:
            out.append(heap_diff(prev, table))
            prev = table
        else:
            out.append(heap_diff({}, {}))
    return out


def _apply_heap_tables(events: list[Any]) -> None:
    """Attach ``heap`` + ``heap_diff`` to STATE events in place.

    ``heap`` is filled only when the step's table is non-empty (an
    explicit ``"h"`` key is left untouched); ``heap_diff`` only when the
    table or the change set is non-empty. ``$id``-less traces therefore
    keep both fields None — byte-identical wire output.
    """
    tables = heap_at_step(events)
    prev: dict[str, dict] = {}
    for event, table in zip(events, tables):
        if event.type != EventType.STATE:
            continue
        diff = heap_diff(prev, table)
        prev = table
        if event.heap is None and table:
            event.heap = table
        if event.heap is not None and (
            table or diff["added"] or diff["removed"] or diff["mutated"]
        ):
            event.heap_diff = diff


def _heap_id_key(k: Any) -> tuple[int, Any]:
    try:
        return (0, int(k))
    except (TypeError, ValueError):
        return (1, str(k))


def _changed_keys(old: Any, new: Any) -> list[str]:
    """Field names differing between two heap entries (never raises)."""
    if isinstance(old, dict) and isinstance(new, dict):
        if "fields" in old or "fields" in new or "refs" in old or "refs" in new:
            merged = {
                **(old.get("fields") if isinstance(old.get("fields"), dict) else {}),
                **(old.get("refs") if isinstance(old.get("refs"), dict) else {}),
                **(new.get("fields") if isinstance(new.get("fields"), dict) else {}),
                **(new.get("refs") if isinstance(new.get("refs"), dict) else {}),
            }
            return sorted((k for k in merged if _field_val(old, k) != _field_val(new, k)), key=str)
        keys = set(old) | set(new)
        return sorted((str(k) for k in keys if old.get(k) != new.get(k)), key=str)
    return ["$value"]


def _field_val(entry: dict, key: str) -> Any:
    fields = entry.get("fields")
    if isinstance(fields, dict) and key in fields:
        return fields[key]
    refs = entry.get("refs")
    if isinstance(refs, dict) and key in refs:
        return refs[key]
    return None


def _extract_heap_table(vars: dict | None) -> dict[str, dict]:
    """Collect ``$id`` objects from STATE vars into a heap table.

    Vars-only on purpose: the ``g`` pack is change-deduped (absent most
    steps), so scanning it would churn ids in and out of the table.
    Nested first-sighting objects register their own entries while the
    parent records a ref; ``$ref``/``$cycle``/``null`` pointer fields
    become refs; scalars stay in fields. ``$addr``-only or malformed
    values are ignored verbatim — never raise.
    """
    table: dict[str, dict] = {}
    try:
        if isinstance(vars, dict):
            for value in vars.values():
                _walk_heap_value(value, table)
        for entry in table.values():
            refs = entry.get("refs")
            if not isinstance(refs, dict):
                continue
            for name, target in list(refs.items()):
                if isinstance(target, list):
                    refs[name] = [t if t == "unknown" or t in table else "unknown" for t in target]
                elif target != "unknown" and target not in table:
                    refs[name] = "unknown"
    except Exception:  # noqa: BLE001 — garbage heap payloads yield partial table
        logger.warning("heap walk hit unexpected payload; keeping partial table")
    return table


def _walk_heap_value(value: Any, table: dict[str, dict]) -> Any:
    """Walk one value; return ("id", key) / ("ref", key|"unknown") /
    ("list", items) / ("scalar", value). Registers ``$id`` objects.
    Key payloads are always STRINGS matching the table keys."""
    if isinstance(value, dict):
        id_ = value.get("$id")
        if isinstance(id_, int) and not isinstance(id_, bool):
            key = str(id_)
            if key not in table:
                table[key] = {}  # placeholder: breaks $cycle recursion
                table[key] = _build_heap_entry(value, table)
            return ("id", key)
        ref = value.get("$ref")
        if isinstance(ref, int) and not isinstance(ref, bool):
            return ("ref", str(ref))
        if "$ref" in value:
            return ("ref", "unknown")
        return ("scalar", value)
    if isinstance(value, list):
        return ("list", [_walk_heap_value(v, table) for v in value])
    return ("scalar", value)


def _norm_heap_item(walked: tuple, raw: Any) -> Any:
    """Normalize one element of a mixed list into a refs entry."""
    kind, payload = walked
    if kind in ("id", "ref") and payload != "unknown":
        return payload
    if kind == "ref":
        return "unknown"
    return "unknown" if isinstance(raw, (dict, list)) else raw


def _build_heap_entry(obj: dict, table: dict[str, dict]) -> dict:
    """Split one ``$id`` object into type/fields/refs (+addr).

    Contract (locked for todo 17 HeapPanel): refs values are STRINGS
    matching this step's table keys, or "unknown"; container items
    lists hold the same."""
    fields: dict[str, Any] = {}
    refs: dict[str, Any] = {}
    for name, val in obj.items():
        if name in ("$id", "$addr"):
            continue
        kind, payload = _walk_heap_value(val, table)
        if kind == "id" or kind == "ref":
            refs[name] = payload
        elif kind == "list":
            if all(p[0] == "scalar" for p in payload):
                fields[name] = val
            else:
                refs[name] = [_norm_heap_item(p, v) for (p, v) in zip(payload, val)]
        else:
            fields[name] = val
    addr = obj.get("$addr")
    return {
        "type": "container" if "items" in obj else "struct",
        "fields": fields,
        "refs": refs,
        "addr": addr if isinstance(addr, str) else None,
    }


def _cap_stdout(text: str) -> tuple[str, bool]:
    """Cap cumulative stdout at 64KB (UTF-8 code-point safe)."""
    raw = text.encode("utf-8")
    if len(raw) <= _STDOUT_CAP_BYTES:
        return text, False
    return raw[:_STDOUT_CAP_BYTES].decode("utf-8", errors="ignore"), True


def _apply_incremental_stdout(events: list[Any], deltas: list[str | None]) -> None:
    """Fold per-event "o" deltas into cumulative STATE stdout in place.

    Absent everywhere → v1 trace, stdout stays None. Present (even "") →
    every STATE gets the cumulative output (small traces) or, for traces
    over the adaptive threshold, only loop-boundary STATEs do: a STATE
    next to the first/last ITER of its source line, plus the final STATE
    (loop-exit / program-end snapshot). Transport "o" is stripped from
    non-STATE events so only STATE carries stdout on the wire.
    """
    if not any(d is not None for d in deltas):
        return

    boundary: set[int] | None = None
    if len(events) > _ADAPTIVE_STEP_THRESHOLD:
        first_iter: dict[int, int] = {}
        last_iter: dict[int, int] = {}
        for i, event in enumerate(events):
            if event.type == EventType.LOOP_ITER:
                first_iter.setdefault(event.line, i)
                last_iter[event.line] = i
        edge_iters = set(first_iter.values()) | set(last_iter.values())
        state_indices = [i for i, e in enumerate(events) if e.type == EventType.STATE]
        boundary = {state_indices[-1]} if state_indices else set()
        for i in state_indices:
            if (i - 1) in edge_iters or (i + 1) in edge_iters:
                boundary.add(i)

    cumulative = ""
    for i, event in enumerate(events):
        d = deltas[i]
        if d:
            cumulative += d
        if event.type == EventType.STATE:
            if boundary is None or i in boundary:
                capped, truncated = _cap_stdout(cumulative)
                event.stdout = capped
                event.stdout_truncated = truncated
            else:
                event.stdout = None
                event.stdout_truncated = False
        else:
            extra = getattr(event, "__pydantic_extra__", None)
            if isinstance(extra, dict):
                extra.pop("o", None)


def _compress_state_events(events: list[Any]) -> list[Any]:
    """Collapse consecutive STATE events with identical vars AND output/heap.

    Only STATE events are compressed — FUNC_ENTER, FUNC_EXIT, BRANCH, and
    LOOP_ITER events are never grouped. A group continues only while vars,
    cumulative stdout, and heap all match; a differing stdout or heap breaks
    the group (vars-equality alone would hide growing output). Absent
    stdout/heap (None) matches only absent, so v1 traces group as before.

    Each group is replaced by its *first* event carrying extra attributes
    (via ``__pydantic_extra__`` so they survive ``model_dump``):
        ``group_start``   — index of the first event in the original list
        ``group_end``     — index of the last event in the group
        ``group_count``   — number of consecutive identical events
        ``compressed``    — True
    """
    if not events:
        return events

    result: list[Any] = []
    i = 0
    n = len(events)

    while i < n:
        event = events[i]

        if event.type != EventType.STATE:
            result.append(event)
            i += 1
            continue

        group_start = i
        _serialise_vars(event)
        j = i + 1
        while j < n and events[j].type == EventType.STATE:
            _serialise_vars(events[j])
            if events[j]._vars_cache != event._vars_cache:
                break
            if events[j].stdout != event.stdout:
                break
            if _serialise_heap(events[j]) != _serialise_heap(event):
                break
            j += 1

        group_count = j - i

        if group_count > 1:
            # Tag the event with compression metadata via __pydantic_extra__
            # so it survives model_dump(by_alias=False).
            event.__pydantic_extra__["group_start"] = group_start
            event.__pydantic_extra__["group_end"] = j - 1
            event.__pydantic_extra__["group_count"] = group_count
            event.__pydantic_extra__["compressed"] = True
            del event._vars_cache
            result.append(event)
        else:
            del event._vars_cache
            result.append(event)

        i = j

    return result


def _serialise_heap(event: Any) -> str | None:
    """Stable JSON string of ``event.heap`` for group comparison (None when absent)."""
    heap = event.heap
    if heap is None:
        return None
    return json.dumps(heap, sort_keys=True, default=str)


def _serialise_vars(event: Any) -> None:
    """Compute a stable JSON string of ``event.vars`` for comparison.

    Uses ``sort_keys`` so dict-key order differences don't break the
    comparison.  The result is cached on ``_vars_cache`` to avoid
    re-serialising the same event multiple times.
    """
    event._vars_cache = json.dumps(event.vars, sort_keys=True, default=str)
