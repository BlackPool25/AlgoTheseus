"""test_dead_loop_var_red.py — P1-07: dead loop vars in frames.

The injector already filters out-of-scope loop vars from STATE probes
(`loop_var_ranges` — post-loop `s += 10;` emits `v={"s": 3}`, no `k`),
but ``frames_at_step`` merges with cumulative ``vars.update()``, so the
rendered post-loop frame still shows the stale ``k``::

    state l=8 v={s:3}  but  frame {'s': 3, 'k': 2}

The fix (todo 15, parser.py only): a non-empty STATE probe names the full
in-scope set at that line, so the frame becomes exactly that set — names
absent from it are dead and dropped. An empty probe (``v={}``, e.g. the
``try {`` line in throw traces) carries no scope information and leaves
the frame untouched. ``loop_var_ranges`` in the injector is NOT touched.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

from app.core.instrumenter.injector import instrument
from app.core.trace.parser import frames_at_step, parse

TRACER_H = Path(__file__).parent.parent / "app" / "core" / "instrumenter" / "tracer.h"

LOOP_SRC = (
    "#include <bits/stdc++.h>\n"
    "using namespace std;\n"
    "int main() {\n"
    "    int s = 0;\n"
    "    for (int k = 0; k < 3; ++k) {\n"
    "        s += k;\n"
    "    }\n"
    "    s += 10;\n"
    "    cout << s << endl;\n"
    "    return 0;\n"
    "}\n"
)

# Wire mirror of the real loop trace: in-loop STATEs name {s, k}, the
# post-loop STATE at l=8 names {s} only (injector filtering works).
LOOP_WIRE = [
    {"t": "enter", "l": 3, "f": "main", "d": 0, "p": {}},
    {"t": "state", "l": 4, "f": "main", "d": 0, "v": {"s": 0}},
    {"t": "state", "l": 5, "f": "main", "d": 0, "v": {"s": 0, "k": 0}},
    {"t": "state", "l": 6, "f": "main", "d": 0, "v": {"s": 0, "k": 0}},
    {"t": "state", "l": 6, "f": "main", "d": 0, "v": {"s": 1, "k": 1}},
    {"t": "state", "l": 6, "f": "main", "d": 0, "v": {"s": 3, "k": 2}},
    {"t": "state", "l": 8, "f": "main", "d": 0, "v": {"s": 3}},
    {"t": "state", "l": 9, "f": "main", "d": 0, "v": {"s": 13}},
    {"t": "exit", "l": 10, "f": "main", "d": 0, "r": 0},
]


def _raw(wire: list[dict]) -> list[str]:
    return [json.dumps(ev) for ev in wire]


def _compile_and_run(source: str, tmp_path: Path) -> tuple[int, str, str]:
    src = tmp_path / "loop.cpp"
    src.write_text(source)
    shutil.copy(TRACER_H, tmp_path / "tracer.h")
    binary = tmp_path / "loop"
    comp = subprocess.run(
        ["g++", "-O0", "-std=c++17", "-I", str(tmp_path), "-o", str(binary), str(src)],
        capture_output=True,
        text=True,
        check=False,
    )
    if comp.returncode != 0:
        return comp.returncode, "", comp.stderr
    run = subprocess.run([str(binary)], capture_output=True, text=True, check=False)
    return run.returncode, run.stdout, run.stderr


def _trace_lines(stderr: str) -> list[str]:
    return [line[len("TRACE:") :] for line in stderr.splitlines() if line.startswith("TRACE:")]


class TestDeadLoopVar:
    def test_post_loop_frame_drops_dead_k(self) -> None:
        """Post-loop frame agrees with its STATE: `k` is gone."""
        events = parse(_raw(LOOP_WIRE))
        assert events[6].vars == {"s": 3}  # injector filtering (already works)
        frames = frames_at_step(events)
        assert frames[6][0].vars == {"s": 3}, (
            f"HEAD leaks dead k into the frame: {frames[6][0].vars}"
        )
        assert frames[7][0].vars == {"s": 13}

    def test_in_loop_frames_keep_k(self) -> None:
        """Control: while the loop is live, frames still show `k`."""
        events = parse(_raw(LOOP_WIRE))
        frames = frames_at_step(events)
        for step in (2, 3, 4, 5):
            assert frames[step][0].vars["k"] == LOOP_WIRE[step]["v"]["k"], (
                f"in-loop frame lost live k at step {step}: {frames[step][0].vars}"
            )
            assert "s" in frames[step][0].vars

    def test_empty_state_preserves_frame(self) -> None:
        """A var-less probe (`v={}`, e.g. `try {`) carries no scope info."""
        events = parse(
            _raw(
                [
                    {"t": "enter", "l": 1, "f": "main", "d": 0, "p": {}},
                    {"t": "state", "l": 2, "f": "main", "d": 0, "v": {"x": 1}},
                    {"t": "state", "l": 3, "f": "main", "d": 0, "v": {}},
                    {"t": "state", "l": 4, "f": "main", "d": 0, "v": {"x": 2}},
                ]
            )
        )
        frames = frames_at_step(events)
        assert frames[2][0].vars == {"x": 1}, (
            f"empty probe must not wipe the frame: {frames[2][0].vars}"
        )
        assert frames[3][0].vars == {"x": 2}

    def test_dead_loop_var_end_to_end(self, tmp_path: Path) -> None:
        """Happy path: real loop trace — STATE drops `k`, frame follows."""
        src = tmp_path / "loop.cpp"
        src.write_text(LOOP_SRC)
        out = instrument(LOOP_SRC, str(src))
        code, stdout, stderr = _compile_and_run(out, tmp_path)
        assert code == 0, f"loop program failed to run:\n{stderr}"
        assert stdout.strip() == "13"
        events = parse(_trace_lines(stderr))
        frames = frames_at_step(events)
        in_loop = next(
            i for i, e in enumerate(events) if e.type.value == "state" and "k" in (e.vars or {})
        )
        assert "k" in frames[in_loop][0].vars
        post_loop = next(
            i
            for i, e in enumerate(events)
            if i > in_loop
            and e.type.value == "state"
            and "s" in (e.vars or {})
            and "k" not in (e.vars or {})
        )
        assert "k" not in frames[post_loop][0].vars, (
            f"post-loop frame leaks k: {frames[post_loop][0].vars}"
        )
        assert frames[post_loop][0].vars == dict(events[post_loop].vars or {})
