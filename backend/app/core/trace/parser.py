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

from .models import (
    BranchEvent,
    EventType,
    FuncEnterEvent,
    FuncExitEvent,
    LoopIterEvent,
    StateEvent,
    TraceEvent,
)

logger = logging.getLogger(__name__)

# TypeAdapter lets us validate a discriminated union without a wrapper model
_event_adapter: TypeAdapter[TraceEvent] = TypeAdapter(TraceEvent)  # type: ignore[type-arg]


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

    if compressed:
        events = _compress_state_events(events)

    return events


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
