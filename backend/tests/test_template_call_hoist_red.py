"""test_template_call_hoist_red.py — template-id / detached-callee single-eval (P1-02).

P1-02: `_CALL_LIKE_RE` only matches `ident (` so template-id calls
(`pred<int>(n)`), parenthesized callees (`(f)()`), and lambda-IIFE
conditions slip through `_may_have_side_effects` as "pure" and stay on
the legacy duplicate-evaluation path: the condition appears both in the
BRANCH probe and in the surviving `if`, so a side-effecting condition
runs twice (`calls=2` vs baseline `calls=1`).

Fix: extend call detection so those three shapes are maybe-impure and
hoisted (`bool __algotrace_c_N = ((cond) ? true : false);` evaluated
once); provably-pure `a > 0` stays on the legacy path (goldens unchanged).

Tests 1-3 MUST FAIL on pre-fix code (calls==2); the rest lock the
controls (pure legacy path, correct tk).
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from pathlib import Path

from app.core.instrumenter.injector import instrument

TRACER_H = Path(__file__).parent.parent / "app" / "core" / "instrumenter" / "tracer.h"

# P1-02 shape 1: template-id call in the condition.
TEMPLATE_SRC = (
    "#include <iostream>\n"
    "int calls = 0;\n"
    "template <typename T> bool pred(T n) { ++calls; return n > 0; }\n"
    "int main() {\n"
    "    int n = 5;\n"
    "    if (pred<int>(n)) { std::cout << \"yes\" << std::endl; }\n"
    "    std::cout << calls << std::endl;\n"
    "    return 0;\n"
    "}\n"
)

# P1-02 shape 2: parenthesized callee — the call parens are detached from
# the identifier, so plain `ident (` matching misses it.
DETACHED_SRC = (
    "#include <iostream>\n"
    "int calls = 0;\n"
    "bool f() { ++calls; return true; }\n"
    "int main() {\n"
    "    if ((f)()) { std::cout << \"yes\" << std::endl; }\n"
    "    std::cout << calls << std::endl;\n"
    "    return 0;\n"
    "}\n"
)

# P1-02 shape 3: lambda-IIFE condition.
IIFE_SRC = (
    "#include <iostream>\n"
    "int calls = 0;\n"
    "int main() {\n"
    "    if (([&]() { ++calls; return true; })()) { std::cout << \"yes\" << std::endl; }\n"
    "    std::cout << calls << std::endl;\n"
    "    return 0;\n"
    "}\n"
)

# Control: provably-pure condition — must stay on the legacy path.
PURE_SRC = (
    "#include <iostream>\n"
    "int main() {\n"
    "    int a = 5;\n"
    "    if (a > 0) { std::cout << \"yes\" << std::endl; }\n"
    "    return 0;\n"
    "}\n"
)


def _compile_and_run(source: str) -> tuple[int, str, str, list[dict]]:
    """Instrument, compile, run; return (code, stderr, stdout, events)."""
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        (tmp_path / "prog.cpp").write_text(instrument(source, "prog.cpp"))
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


def test_template_call_single_eval():
    code, err, out, _ = _compile_and_run(TEMPLATE_SRC)
    assert code == 0, f"g++ failed: {err}"
    assert out.splitlines()[-1] == "1", f"template cond double-evaluated, stdout={out!r}"


def test_detached_callee_single_eval():
    code, err, out, _ = _compile_and_run(DETACHED_SRC)
    assert code == 0, f"g++ failed: {err}"
    assert out.splitlines()[-1] == "1", f"detached cond double-evaluated, stdout={out!r}"


def test_iife_cond_single_eval():
    code, err, out, _ = _compile_and_run(IIFE_SRC)
    assert code == 0, f"g++ failed: {err}"
    assert out.splitlines()[-1] == "1", f"IIFE cond double-evaluated, stdout={out!r}"


def test_pure_cond_stays_legacy():
    instrumented = instrument(PURE_SRC, "prog.cpp")
    assert "__algotrace_c_" not in instrumented, "pure cond must not hoist"
    code, err, out, events = _compile_and_run(PURE_SRC)
    assert code == 0, f"g++ failed: {err}"
    assert out == "yes"
    assert _branch_tks(events) == [True]
