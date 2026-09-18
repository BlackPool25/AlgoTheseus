"""test_governed_sideeffect_red.py — governed side-effect cond double-eval (P1-04).

P1-04: `_wrap_loop_governed_if` brace-wraps a loop-governed braceless `if`
with the BRANCH probe inside, but the condition text survives in BOTH the
probe and the `if` — a side-effecting condition (`takeNext()`, true on odd
calls) runs twice per iteration. Probe evals (calls 1,3,5,7, all true) and
`if` evals (calls 2,4,6,8, all false) disagree: bodies=0, calls=8, and the
trace claims `tk=true x4` while zero bodies ran.

Fix: hoist side-effecting governed conditions into the introduced braces
(`bool __algotrace_c_N = ((cond) ? true : false);` evaluated once, shared
by probe and `if`). Pure governed conditions keep the legacy shape
(byte-identical, no temp).

Tests 1-2 MUST FAIL on pre-fix code (stdout `0 8`, `tk=true x4`); the rest
lock the controls (pure legacy path, split-line shape, tk parity).
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from pathlib import Path

from app.core.instrumenter.injector import instrument

TRACER_H = Path(__file__).parent.parent / "app" / "core" / "instrumenter" / "tracer.h"

# P1-04 shape: parity-flipping cond governed by a same-line for. Baseline
# (uninstrumented): calls 1..4 -> T,F,T,F, bodies=2, calls=4 ("2 4").
# Double-eval: probe takes calls 1,3,5,7 (all true), `if` takes 2,4,6,8
# (all false) -> bodies=0, calls=8 ("0 8") with tk=true x4.
SAME_SRC = (
    "#include <iostream>\n"
    "int calls = 0;\n"
    "bool takeNext() { ++calls; return (calls % 2) == 1; }\n"
    "int main() {\n"
    "    int bodies = 0;\n"
    "    for (int i = 0; i < 4; ++i) if (takeNext()) ++bodies;\n"
    "    std::cout << bodies << \" \" << calls << std::endl;\n"
    "    return 0;\n"
    "}\n"
)

# Split-line twin: bare `for (...)` header with the if on the next line.
SPLIT_SRC = (
    "#include <iostream>\n"
    "int calls = 0;\n"
    "bool takeNext() { ++calls; return (calls % 2) == 1; }\n"
    "int main() {\n"
    "    int bodies = 0;\n"
    "    for (int i = 0; i < 4; ++i)\n"
    "        if (takeNext()) ++bodies;\n"
    "    std::cout << bodies << \" \" << calls << std::endl;\n"
    "    return 0;\n"
    "}\n"
)

# Control: pure governed condition — must keep the legacy shape (no temp).
PURE_SRC = (
    "#include <iostream>\n"
    "#include <vector>\n"
    "int main() {\n"
    "    std::vector<int> indeg(4, 0);\n"
    "    int n = 0;\n"
    "    for (int i = 0; i < 4; ++i) if (indeg[i] == 0) ++n;\n"
    "    std::cout << n << std::endl;\n"
    "    return 0;\n"
    "}\n"
)


def _compile_and_run(source: str) -> tuple[int, str, str, list[dict]]:
    """Instrument, compile, run; return (code, stderr, stdout, events)."""
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        # source_path=None: always parse via temp file (a relative hint like
        # "prog.cpp" only works when the expander rewrites the source).
        (tmp_path / "prog.cpp").write_text(instrument(source, None))
        shutil.copy(TRACER_H, tmp_path / "tracer.h")
        binary = tmp_path / "prog"
        compiled = subprocess.run(
            ["g++", "-O0", "-std=c++17", "-I", str(tmp_path),
             "-o", str(binary), str(tmp_path / "prog.cpp")],
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


def _branch_tks(events: list[dict]) -> list:
    return [e["tk"] for e in events if e.get("t") == "branch"]


def test_governed_sideeffect_single_eval():
    code, err, out, events = _compile_and_run(SAME_SRC)
    assert code == 0, f"g++ failed: {err}"
    assert out == "2 4", f"governed cond double-evaluated, stdout={out!r}"
    assert _branch_tks(events) == [True, False, True, False], (
        f"branch tk must match bodies executed, tk={_branch_tks(events)!r}"
    )


def test_governed_sideeffect_split_single_eval():
    code, err, out, events = _compile_and_run(SPLIT_SRC)
    assert code == 0, f"g++ failed: {err}"
    assert out == "2 4", f"split governed cond double-evaluated, stdout={out!r}"
    assert _branch_tks(events) == [True, False, True, False], (
        f"branch tk must match bodies executed, tk={_branch_tks(events)!r}"
    )


def test_governed_hoist_emits_temp():
    instrumented = instrument(SAME_SRC, None)
    assert "__algotrace_c_" in instrumented, "side-effecting governed cond must hoist"
    assert instrumented.count("(takeNext())") == 1, (
        "hoisted cond must evaluate once (decl); probe shares the temp, "
        "the branch c-string and the takeNext definition are not evaluations"
    )


def test_governed_pure_stays_legacy():
    instrumented = instrument(PURE_SRC, None)
    assert "__algotrace_c_" not in instrumented, "pure governed cond must not hoist"
    code, err, out, events = _compile_and_run(PURE_SRC)
    assert code == 0, f"g++ failed: {err}"
    assert out == "4"
    assert _branch_tks(events) == [True, True, True, True]
