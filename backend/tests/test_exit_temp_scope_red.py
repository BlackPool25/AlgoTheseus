"""test_exit_temp_scope_red.py — scope-safe FUNC_EXIT temps (P0-07, P0-08).

P0-07: an unsafe return (`g(v)+1` — parens+call, temp path) directly under a
`case` label emits `auto __trace_ret_N` at switch scope, so jumping to a later
`case`/`default` crosses the initialization (g++ `jump to case label`).
P0-08: the same temp between a forward `goto` and its label errors with
`jump to label ... crosses initialization`. (Note: a *braceless*
`if (v > 0) goto done;` is already rescued by the braceless-if brace-wrap
guard, so the goto RED uses a braced `if` with the `goto` inside.)

Fix (mandated): each unsafe-return site becomes its own brace block holding
the temp — `{ auto __trace_ret_N = (expr); __TRACE_FUNC_EXIT(...); return
__trace_ret_N; }` — at the FUNC_EXIT temp path and the
`__trace_ret_fallback_*` path. Safe-expr path untouched.

Tests 1-2 MUST FAIL on pre-fix code (compile breaks); the rest lock the
controls (plain returns and braced-switch returns compile+run unchanged,
exit events carry the correct `r`).
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from pathlib import Path

from app.core.instrumenter.injector import instrument

TRACER_H = Path(__file__).parent.parent / "app" / "core" / "instrumenter" / "tracer.h"

# P0-07 shape: unsafe returns directly under unbraced case labels.
SWITCH_SRC = (
    "#include <iostream>\n"
    "int g(int x) { return x * 2; }\n"
    "int f(int v) {\n"
    "    switch (v) {\n"
    "    case 0:\n"
    "        return g(v) + 1;\n"
    "    default:\n"
    "        return g(v) + 2;\n"
    "    }\n"
    "}\n"
    "int main() { std::cout << f(0) << \" \" << f(5) << std::endl; return 0; }\n"
)

# P0-08 shape: forward goto over an unsafe return (braced if — braceless
# if+goto is already brace-wrapped by the braceless-if guard). A statement
# sits between the label and the second return so the walker emits FUNC_EXIT
# for both paths (a bare `done: return 0;` gets no injection point at all —
# pre-existing walker behavior, out of scope).
GOTO_SRC = (
    "#include <iostream>\n"
    "int g(int x) { return x * 2; }\n"
    "int f(int v) {\n"
    "    if (v > 0) {\n"
    "        goto done;\n"
    "    }\n"
    "    return g(v) + 1;\n"
    "done:\n"
    "    v = 0;\n"
    "    return g(v);\n"
    "}\n"
    "int main() { std::cout << f(-3) << \" \" << f(5) << std::endl; return 0; }\n"
)

# Control: plain unsafe return with no labels — compiles before and after.
PLAIN_SRC = (
    "#include <iostream>\n"
    "int g(int x) { return x * 2; }\n"
    "int f(int v) {\n"
    "    return g(v) + 1;\n"
    "}\n"
    "int main() { std::cout << f(3) << std::endl; return 0; }\n"
)

# Control: switch whose case bodies are braced — compiles before and after.
BRACED_SWITCH_SRC = (
    "#include <iostream>\n"
    "int g(int x) { return x * 2; }\n"
    "int f(int v) {\n"
    "    switch (v) {\n"
    "    case 0: {\n"
    "        return g(v) + 1;\n"
    "    }\n"
    "    default: {\n"
    "        return g(v) + 2;\n"
    "    }\n"
    "    }\n"
    "}\n"
    "int main() { std::cout << f(0) << \" \" << f(5) << std::endl; return 0; }\n"
)


def _compile_and_run(source: str) -> tuple[int, str, str, list[dict]]:
    """Compile instrumented source, run it; return (code, stderr, stdout, events)."""
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        src = tmp_path / "prog.cpp"
        src.write_text(source)
        shutil.copy(TRACER_H, tmp_path / "tracer.h")
        binary = tmp_path / "prog"
        compiled = subprocess.run(
            ["g++", "-O0", "-std=c++17", "-I", str(tmp_path),
             "-o", str(binary), str(src)],
            capture_output=True, text=True, check=False,
        )
        if compiled.returncode != 0:
            return compiled.returncode, compiled.stderr, "", []
        ran = subprocess.run(
            [str(binary)], capture_output=True, text=True, check=False, timeout=60,
        )
        events = []
        for line in ran.stderr.splitlines():
            if line.startswith("TRACE:"):
                try:
                    events.append(json.loads(line[len("TRACE:"):]))
                except json.JSONDecodeError:
                    pass
        return 0, "", ran.stdout.strip(), events


def _exit_values(events: list[dict], func: str) -> list:
    return [e["r"] for e in events if e.get("t") == "exit" and e.get("f") == func]


class TestExitTempScope:
    def test_switch_case_unsafe_return_compiles_and_runs(
        self, tmp_path: Path,
    ) -> None:
        """RED driver P0-07: unbraced case-label returns must compile+run."""
        src = tmp_path / "switch.cpp"
        src.write_text(SWITCH_SRC)
        out = instrument(SWITCH_SRC, str(src))
        code, stderr, stdout, events = _compile_and_run(out)
        assert code == 0, f"case label jumps cross temp init:\n{stderr}"
        assert stdout == "1 12", f"wrong stdout: {stdout!r}"
        assert sorted(_exit_values(events, "f")) == [1, 12]

    def test_goto_over_unsafe_return_compiles_and_runs(
        self, tmp_path: Path,
    ) -> None:
        """RED driver P0-08: forward goto over an unsafe return must compile+run."""
        src = tmp_path / "goto.cpp"
        src.write_text(GOTO_SRC)
        out = instrument(GOTO_SRC, str(src))
        code, stderr, stdout, events = _compile_and_run(out)
        assert code == 0, f"goto jumps cross temp init:\n{stderr}"
        assert stdout == "-5 0", f"wrong stdout: {stdout!r}"
        assert sorted(_exit_values(events, "f")) == [-5, 0]

    def test_plain_unsafe_return_unchanged(self, tmp_path: Path) -> None:
        """Control: plain unsafe return (no labels) compiles+runs with right `r`."""
        src = tmp_path / "plain.cpp"
        src.write_text(PLAIN_SRC)
        out = instrument(PLAIN_SRC, str(src))
        code, stderr, stdout, events = _compile_and_run(out)
        assert code == 0, f"plain return broke:\n{stderr}"
        assert stdout == "7", f"wrong stdout: {stdout!r}"
        assert _exit_values(events, "f") == [7]

    def test_braced_switch_return_unchanged(self, tmp_path: Path) -> None:
        """Control: braced-switch returns compile+run with right `r`."""
        src = tmp_path / "braced.cpp"
        src.write_text(BRACED_SWITCH_SRC)
        out = instrument(BRACED_SWITCH_SRC, str(src))
        code, stderr, stdout, events = _compile_and_run(out)
        assert code == 0, f"braced switch broke:\n{stderr}"
        assert stdout == "1 12", f"wrong stdout: {stdout!r}"
        assert sorted(_exit_values(events, "f")) == [1, 12]
