"""test_toplevel_braceless_loop_red.py — P0-01: top-level braceless loop header STATE.

A `for (int i …)` that directly governs a braceless `if … else …` chain
emits two scope-breaking probes on HEAD:

1. `_walk_cursor` emits a function-body-direct-child STATE for the
   braceless loop header (the S8 nested-loop skip exists only in
   `_walk_stmt`). `_state_insert_line` slides it onto the then-body line
   whose next line is `else`, and the else-guard `add_before`s it onto the
   header line — before the `for`, where `i` is undeclared.
2. The `if`-header STATE takes the same else-guard `add_before` path and
   lands between the bare `for` header and its body, detaching the body
   (`'i' was not declared in this scope` at `__TRACE_STATE(…)`).

Both RED drivers MUST FAIL on pre-fix code; the rest lock placement,
runtime output, branch taken flags, and per-iteration states.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from pathlib import Path

from app.core.instrumenter.ast_walker import InjectKind, walk
from app.core.instrumenter.injector import instrument

TRACER_H = Path(__file__).parent.parent / "app" / "core" / "instrumenter" / "tracer.h"

# P0-01: top-level braceless for governing a braceless if/else chain.
BRACELESS_LOOP_IF_ELSE_SRC = (
    "#include <bits/stdc++.h>\n"
    "using namespace std;\n"
    "int main() {\n"
    "    for (int i = 0; i < 4; ++i)\n"
    "        if (i % 2 == 0)\n"
    "            cout << \"even \" << i << '\\n';\n"
    "        else\n"
    "            cout << \"odd \" << i << '\\n';\n"
    "    return 0;\n"
    "}\n"
)

FOR_LINE = 4  # `for (int i = 0; …)` header line in BRACELESS_LOOP_IF_ELSE_SRC
IF_LINE = 5  # `if (i % 2 == 0)` header line


def _compile(source: str) -> tuple[int, str]:
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        src = tmp_path / "prog.cpp"
        src.write_text(source)
        shutil.copy(TRACER_H, tmp_path / "tracer.h")
        binary = tmp_path / "prog"
        result = subprocess.run(
            ["g++", "-O0", "-std=c++17", "-I", str(tmp_path), "-o", str(binary), str(src)],
            capture_output=True,
            text=True,
            check=False,
        )
        return result.returncode, result.stderr


def _compile_and_run(source: str) -> tuple[int, str, str]:
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        src = tmp_path / "prog.cpp"
        src.write_text(source)
        shutil.copy(TRACER_H, tmp_path / "tracer.h")
        binary = tmp_path / "prog"
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


def _trace_events(stderr: str) -> list[dict]:
    events = []
    for line in stderr.splitlines():
        if line.startswith("TRACE:"):
            events.append(json.loads(line[len("TRACE:") :]))
    return events


class TestToplevelBracelessLoop:
    def test_braceless_loop_if_else_compiles(self, tmp_path: Path) -> None:
        """RED driver P0-01: no `'i' was not declared` at `__TRACE_STATE`."""
        src = tmp_path / "tlbl.cpp"
        src.write_text(BRACELESS_LOOP_IF_ELSE_SRC)
        out = instrument(BRACELESS_LOOP_IF_ELSE_SRC, str(src))
        code, stderr = _compile(out)
        assert code == 0, f"braceless loop if/else failed to compile:\n{stderr}"

    def test_no_top_level_header_state_point(self, tmp_path: Path) -> None:
        """Walker pin: S8 skip applies at top level — no header STATE."""
        src = tmp_path / "t.lbl_walk.cpp"
        src.write_text(BRACELESS_LOOP_IF_ELSE_SRC)
        result = walk(str(src))
        header_states = [
            p for p in result.injection_points if p.kind == InjectKind.STATE and p.line == FOR_LINE
        ]
        assert not header_states, (
            f"top-level braceless loop header must not emit STATE: {header_states}"
        )

    def test_no_state_before_loop_header(self, tmp_path: Path) -> None:
        """No `__TRACE_STATE` naming `i` may precede the bare `for` header."""
        src = tmp_path / "t-lbl_place.cpp"
        src.write_text(BRACELESS_LOOP_IF_ELSE_SRC)
        out = instrument(BRACELESS_LOOP_IF_ELSE_SRC, str(src))
        lines = out.splitlines()
        for_idx = next(i for i, l in enumerate(lines) if l.strip().startswith("for (int i"))
        leaked = [
            f"instr-line {i + 1}: {l.strip()}"
            for i, l in enumerate(lines[:for_idx])
            if "__TRACE_STATE" in l and '"i", i' in l
        ]
        assert not leaked, "probe leaked before loop scope:\n" + "\n".join(leaked)

    def test_stdout_correct(self, tmp_path: Path) -> None:
        """even 0 / odd 1 / even 2 / odd 3 — the body must stay governed."""
        src = tmp_path / "t-lbl_run.cpp"
        src.write_text(BRACELESS_LOOP_IF_ELSE_SRC)
        out = instrument(BRACELESS_LOOP_IF_ELSE_SRC, str(src))
        code, stdout, stderr = _compile_and_run(out)
        assert code == 0, f"instrumented binary failed:\n{stderr}"
        assert stdout.split() == ["even", "0", "odd", "1", "even", "2", "odd", "3"], (
            f"wrong stdout: {stdout!r}"
        )

    def test_else_branch_taken_events(self, tmp_path: Path) -> None:
        """Branch events fire with both taken and untaken flags."""
        src = tmp_path / "t-lbl_br.cpp"
        src.write_text(BRACELESS_LOOP_IF_ELSE_SRC)
        out = instrument(BRACELESS_LOOP_IF_ELSE_SRC, str(src))
        code, _stdout, stderr = _compile_and_run(out)
        assert code == 0, f"instrumented binary failed:\n{stderr}"
        branches = [e for e in _trace_events(stderr) if e.get("t") == "branch"]
        assert branches, "expected branch events in trace output"
        flags = {e.get("tk") for e in branches}
        assert True in flags and False in flags, (
            f"expected both taken and untaken branch events, got: {flags}"
        )

    def test_per_iteration_trace_events(self, tmp_path: Path) -> None:
        """One branch event per iteration (tk alternates), states present.

        A braceless then-body admits no chain-safe per-iteration STATE
        placement (any splice between the if-header and its body orphans
        `else`), so body probes relocate after the whole if/else while the
        brace-wrapped BRANCH fires once per iteration with correct flags.
        """
        src = tmp_path / "t-lbl_st.cpp"
        src.write_text(BRACELESS_LOOP_IF_ELSE_SRC)
        out = instrument(BRACELESS_LOOP_IF_ELSE_SRC, str(src))
        code, _stdout, stderr = _compile_and_run(out)
        assert code == 0, f"instrumented binary failed:\n{stderr}"
        events = _trace_events(stderr)
        branches = [e for e in events if e.get("t") == "branch"]
        assert [e.get("tk") for e in branches] == [True, False, True, False], (
            f"expected one branch event per iteration, got: {branches}"
        )
        states = [e for e in events if e.get("t") == "state"]
        assert len(states) >= 2, f"expected relocated state events, got: {states}"
        assert any(e.get("l") == IF_LINE for e in states), (
            "expected the slid if-header state to be present (relocated, not dropped)"
        )
