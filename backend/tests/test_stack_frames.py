"""
test_stack_frames.py — T6: per-step call-stack reconstruction in the parser.

``frames_at_step(events)`` returns a parallel array (one entry per event):
each entry is the list of live ``StackFrame`` snapshots at that step.
``stack_to_render(events, step)`` returns the single-step slice.

- test_stack_to_render_two_frames: nested call shows both frames' locals.
- test_stack_to_render_recursion: recursive calls yield distinct frame_id keys.
- test_parent_vars_persist: parent locals survive child execution until FUNC_EXIT.
"""

from __future__ import annotations

import json

from app.core.trace.parser import frames_at_step, parse, stack_to_render


def _raw(events: list[dict]) -> list[str]:
    return [json.dumps(ev) for ev in events]


TWO_FRAMES = [
    {"t": "enter", "l": 1, "f": "main", "d": 0, "p": {}},
    {"t": "state", "l": 2, "f": "main", "d": 0, "v": {"x": 10}},
    {"t": "enter", "l": 5, "f": "helper", "d": 0, "p": {"a": 3}},
    {"t": "state", "l": 6, "f": "helper", "d": 0, "v": {"a": 3, "y": 99}},
    {"t": "exit", "l": 7, "f": "helper", "d": 0, "r": 102},
    {"t": "state", "l": 3, "f": "main", "d": 0, "v": {"x": 10, "z": 102}},
    {"t": "exit", "l": 4, "f": "main", "d": 0, "r": 0},
]

RECURSION = [
    {"t": "enter", "l": 5, "f": "fact", "d": 0, "p": {"n": 3}},
    {"t": "state", "l": 6, "f": "fact", "d": 0, "v": {"n": 3}},
    {"t": "enter", "l": 5, "f": "fact", "d": 0, "p": {"n": 2}},
    {"t": "state", "l": 6, "f": "fact", "d": 0, "v": {"n": 2}},
    {"t": "enter", "l": 5, "f": "fact", "d": 0, "p": {"n": 1}},
    {"t": "exit", "l": 10, "f": "fact", "d": 0, "r": 1},
    {"t": "exit", "l": 10, "f": "fact", "d": 0, "r": 2},
    {"t": "exit", "l": 10, "f": "fact", "d": 0, "r": 6},
]


def test_stack_to_render_two_frames():
    """Nested call: inner steps show both frames with their own locals."""
    events = parse(_raw(TWO_FRAMES))
    frames = frames_at_step(events)

    # Parallel array: one entry per event, no per-event bloat.
    assert len(frames) == len(events)

    # At the helper STATE step both frames are live with distinct ids.
    inner = frames[3]
    assert [f.func for f in inner] == ["main", "helper"]
    assert inner[0].frame_id != inner[1].frame_id
    assert inner[0].vars == {"x": 10}
    assert inner[1].vars == {"a": 3, "y": 99}
    assert [f.depth for f in inner] == [0, 1]

    # Single-step accessor agrees with the parallel array.
    assert stack_to_render(events, 3) == inner


def test_stack_to_render_recursion():
    """Recursive calls yield one frame per live invocation, distinct ids."""
    events = parse(_raw(RECURSION))
    frames = frames_at_step(events)

    deepest = frames[4]
    assert [f.func for f in deepest] == ["fact", "fact", "fact"]
    ids = [f.frame_id for f in deepest]
    assert len(set(ids)) == 3  # distinct frame_id keys
    assert [f.vars for f in deepest] == [{"n": 3}, {"n": 2}, {"n": 1}]

    # Exits unwind innermost-first; outermost exit leaves one frame behind
    # (snapshot is post-pop) and the final exit empties the stack.
    assert [f.vars for f in frames[5]] == [{"n": 3}, {"n": 2}]
    assert [f.vars for f in frames[6]] == [{"n": 3}]
    assert frames[7] == []


def test_parent_vars_persist():
    """Parent locals persist unchanged while the child runs and after it exits."""
    events = parse(_raw(TWO_FRAMES))
    frames = frames_at_step(events)

    # During the child call (enter, state, exit steps) parent vars are intact.
    for step in (2, 3, 4):
        assert frames[step][0].vars == {"x": 10}

    # After FUNC_EXIT the parent frame is still live with its vars.
    assert [f.func for f in frames[5]] == ["main"]
    assert frames[5][0].vars == {"x": 10, "z": 102}


def test_frames_compose_with_globals_and_post_decl_vars():
    """Frames carry locals while STATE events keep globals/post-decl vars."""
    raw = _raw([
        {"t": "enter", "l": 2, "f": "main", "d": 0, "p": {}},
        {"t": "state", "l": 3, "f": "main", "d": 0,
         "v": {"x": 10, "result": 3}, "g": {"N": 10}},
        {"t": "enter", "l": 8, "f": "solve", "d": 0, "p": {"n": 5}},
        {"t": "state", "l": 9, "f": "solve", "d": 0,
         "v": {"n": 5, "mid": 2}, "g": {"N": 10}},
        {"t": "exit", "l": 12, "f": "solve", "d": 0, "r": 3},
        {"t": "exit", "l": 5, "f": "main", "d": 0, "r": 0},
    ])
    events = parse(raw)
    frames = frames_at_step(events)

    inner = frames[3]
    assert [f.func for f in inner] == ["main", "solve"]
    assert inner[0].vars == {"x": 10, "result": 3}
    assert inner[1].vars == {"n": 5, "mid": 2}
    # Globals stay on the event lane, not duplicated into frames.
    assert events[3].globals == {"N": 10}  # type: ignore[attr-defined]


def test_unbalanced_exit_truncates_gracefully():
    """A FUNC_EXIT with no matching frame (e.g. user exit() call) never raises."""
    events = parse(_raw([
        {"t": "enter", "l": 1, "f": "main", "d": 0, "p": {}},
        {"t": "state", "l": 2, "f": "main", "d": 0, "v": {"x": 1}},
        {"t": "exit", "l": 99, "f": "ghost", "d": 0, "r": 0},
        {"t": "state", "l": 3, "f": "main", "d": 0, "v": {"x": 2}},
    ]))
    frames = frames_at_step(events)  # must not raise
    assert len(frames) == len(events)
    # Unknown exit leaves the live stack untouched; later steps still render.
    assert [f.func for f in frames[2]] == ["main"]
    assert frames[3][0].vars == {"x": 2}
