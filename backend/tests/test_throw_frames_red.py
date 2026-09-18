"""test_throw_frames_red.py — P1-06: throw zombie frames + cross-frame merge.

A C++ `throw` unwinds without emitting FUNC_EXIT for the dead frames (no
RAII exit guard in tracer.h — verified end to end below), so the first event
after the throw is a STATE in the catching function whose `func` does NOT
match the live stack top. On HEAD the parser mishandles that shape three ways:

- depth stays deep: post-catch STATE recomputes to `d=1` (expected 0);
- cross-frame merge: caller's `m=99` is merged into the dead callee frame;
- zombie frames linger until main's exit nukes the whole stack (`frames=[]`).

The fix (todo 14): pop the whole dead suffix `del`-style on the throw path
and merge a STATE only into `stack[-1]` when `event.func` matches (else
truncate to the matching frame). Balanced call/return behavior is unchanged.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

from app.core.instrumenter.injector import instrument
from app.core.trace.parser import frames_at_step, parse

TRACER_H = Path(__file__).parent.parent / "app" / "core" / "instrumenter" / "tracer.h"

THROW_SRC = (
    "#include <bits/stdc++.h>\n"
    "using namespace std;\n"
    "int callee(int y) {\n"
    "    int z = y * 2;\n"
    '    throw runtime_error("boom");\n'
    "    return z;\n"
    "}\n"
    "int main() {\n"
    "    int x = 1;\n"
    "    int m = 0;\n"
    "    try {\n"
    "        m = callee(x);\n"
    "    } catch (...) {\n"
    "        m = 99;\n"
    "    }\n"
    "    return 0;\n"
    "}\n"
)

# Faithful wire copy of the real throw/catch trace (see e2e test): no FUNC_EXIT
# for callee — unwinding emits nothing; main's post-catch STATEs follow directly.
# Wire `d` values are the tracer-emitted ones; parse() recomputes them.
THROW_WIRE = [
    {"t": "enter", "l": 8, "f": "main", "d": 0, "p": {}},
    {"t": "state", "l": 9, "f": "main", "d": 0, "v": {"x": 1}},
    {"t": "enter", "l": 3, "f": "callee", "d": 1, "p": {"y": 1}},
    {"t": "state", "l": 4, "f": "callee", "d": 1, "v": {"y": 1, "z": 2}},
    {"t": "state", "l": 13, "f": "main", "d": 0, "v": {}},
    {"t": "state", "l": 14, "f": "main", "d": 0, "v": {"x": 1, "m": 99}},
    {"t": "exit", "l": 16, "f": "main", "d": 0, "r": 0},
]

# Balanced control: plain nested call/return — must be byte-identical behavior.
BALANCED_WIRE = [
    {"t": "enter", "l": 1, "f": "main", "d": 0, "p": {}},
    {"t": "state", "l": 2, "f": "main", "d": 0, "v": {"x": 10}},
    {"t": "enter", "l": 5, "f": "helper", "d": 0, "p": {"a": 3}},
    {"t": "state", "l": 6, "f": "helper", "d": 0, "v": {"a": 3, "y": 99}},
    {"t": "exit", "l": 7, "f": "helper", "d": 0, "r": 102},
    {"t": "state", "l": 3, "f": "main", "d": 0, "v": {"x": 10, "z": 102}},
    {"t": "exit", "l": 4, "f": "main", "d": 0, "r": 0},
]


def _raw(wire: list[dict]) -> list[str]:
    return [json.dumps(ev) for ev in wire]


def _compile_and_run(source: str, tmp_path: Path) -> tuple[int, str, str]:
    src = tmp_path / "throw.cpp"
    src.write_text(source)
    shutil.copy(TRACER_H, tmp_path / "tracer.h")
    binary = tmp_path / "throw"
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


class TestThrowFrames:
    def test_post_catch_depth_is_zero(self) -> None:
        """Post-catch STATEs recompute to `d=0` — HEAD keeps the dead depth `d=1`."""
        events = parse(_raw(THROW_WIRE))
        assert [e.depth for e in events] == [0, 0, 1, 1, 0, 0, 0], (
            f"depths wrong (HEAD gives d=1 past the throw): {[e.depth for e in events]}"
        )

    def test_callee_popped_at_catch_single_main_frame(self) -> None:
        """First post-catch STATE drops callee; `m=99` lands in main, not the corpse."""
        events = parse(_raw(THROW_WIRE))
        frames = frames_at_step(events)
        assert [f.func for f in frames[4]] == ["main"]
        assert [f.func for f in frames[5]] == ["main"], (
            f"HEAD keeps zombie callee: {[f.func for f in frames[5]]}"
        )
        assert frames[5][0].vars == {"x": 1, "m": 99}, (
            f"HEAD merges m=99 into dead callee: {[(f.func, f.vars) for f in frames[5]]}"
        )

    def test_final_frame_non_empty_then_clean_exit(self) -> None:
        """Last STATE shows a live main frame; main's exit pops it with no zombies."""
        events = parse(_raw(THROW_WIRE))
        frames = frames_at_step(events)
        assert frames[5] != [], "final frame must be non-empty"
        assert frames[5][0].vars.get("m") == 99
        assert frames[6] == [], f"exit must leave a clean stack: {frames[6]}"
        assert all(f.func != "callee" for step in frames[4:] for f in step)

    def test_balanced_calls_unchanged(self) -> None:
        """Control pin: balanced enter/state/exit nests exactly as before."""
        events = parse(_raw(BALANCED_WIRE))
        assert [e.depth for e in events] == [0, 0, 1, 1, 1, 0, 0]
        frames = frames_at_step(events)
        assert [f.func for f in frames[3]] == ["main", "helper"]
        assert frames[3][1].vars == {"a": 3, "y": 99}
        assert [f.func for f in frames[5]] == ["main"]
        assert frames[5][0].vars == {"x": 10, "z": 102}
        assert frames[6] == []

    def test_throw_catch_end_to_end(self, tmp_path: Path) -> None:
        """Happy path: real instrumented throw/catch runs, catch shows one main frame."""
        src = tmp_path / "throw.cpp"
        src.write_text(THROW_SRC)
        out = instrument(THROW_SRC, str(src))
        code, _stdout, stderr = _compile_and_run(out, tmp_path)
        assert code == 0, f"throw/catch program failed to run:\n{stderr}"
        raw = _trace_lines(stderr)
        # Locks the trace shape this fix is built on: the throw emits no exit.
        assert [json.loads(l).get("t") for l in raw].count("exit") == 1
        events = parse(raw)
        frames = frames_at_step(events)
        catch_idx = next(
            i
            for i, e in enumerate(events)
            if e.type.value == "state" and (e.vars or {}).get("m") == 99
        )
        assert events[catch_idx].depth == 0, f"post-catch depth: {events[catch_idx].depth}"
        assert [f.func for f in frames[catch_idx]] == ["main"]
        assert frames[catch_idx][0].vars.get("m") == 99
