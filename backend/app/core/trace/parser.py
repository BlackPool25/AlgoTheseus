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
    BranchEvent,
    EventType,
    FuncEnterEvent,
    FuncExitEvent,
    LoopIterEvent,
    StackFrame,
    StateEvent,
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

    # Accumulate "o" transport deltas into cumulative per-STATE stdout
    # (adaptive granularity + 64KB cap per docs/trace-schema-v2.md).
    _apply_incremental_stdout(events, deltas)

    # Synthesize per-step explanations (pure, never raises).
    for event in events:
        event.step_desc = describe(event)

    if compressed:
        events = _compress_state_events(events)

    return events


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
            stack.append(StackFrame(
                func=event.func,
                frame_id=next_id,
                depth=len(stack),
                vars=dict(getattr(event, "params", None) or {}),
            ))
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

        frames.append([StackFrame(
            func=f.func, frame_id=f.frame_id, depth=f.depth, vars=dict(f.vars),
        ) for f in stack])

    return frames


def stack_to_render(events: list[Any], step: int) -> list[StackFrame]:
    """Live frames to render at a single step (slice of ``frames_at_step``)."""
    return frames_at_step(events)[step]


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
        state_indices = [i for i, e in enumerate(events)
                         if e.type == EventType.STATE]
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
    """Collapse consecutive STATE events whose ``vars`` are identical.

    Only STATE events are compressed — FUNC_ENTER, FUNC_EXIT, BRANCH, and
    LOOP_ITER events are never grouped.

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


def _serialise_vars(event: Any) -> None:
    """Compute a stable JSON string of ``event.vars`` for comparison.

    Uses ``sort_keys`` so dict-key order differences don't break the
    comparison.  The result is cached on ``_vars_cache`` to avoid
    re-serialising the same event multiple times.
    """
    event._vars_cache = json.dumps(event.vars, sort_keys=True, default=str)
