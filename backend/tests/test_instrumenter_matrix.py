"""
test_instrumenter_matrix.py — Wave 3 coverage matrix (TDD RED→GREEN).

8 constructs, each row asserts:
  (a) walk() parses without InstrumentParseError,
  (b) injects-or-skips-with-reason (relevant points present / template skipped),
  (c) instrumented output is `g++ -std=c++17 -fsyntax-only` clean.

Skip-not-brace-wrap policy: braceless single-statement bodies are never
wrapped in braces; they get a STATE on the body line only (no LOOP_ITER).
"""

import shutil
import subprocess
import tempfile
from pathlib import Path

from app.core.instrumenter.ast_walker import InjectKind, walk
from app.core.instrumenter.diagnostics import InstrumentParseError
from app.core.instrumenter.injector import instrument
from app.core.instrumenter.scope_tracker import build_scope_map

TRACER_H = Path(__file__).parent.parent / "app" / "core" / "instrumenter" / "tracer.h"

SRC_BRACELESS_IF = (
    "int classify(int x) {\n"
    "    if (x > 0)\n"
    "        x = 1;\n"
    "    else if (x < 0)\n"
    "        x = -1;\n"
    "    else\n"
    "        x = 0;\n"
    "    return x;\n"
    "}\n"
    "int main() { return classify(5); }\n"
)

SRC_SWITCH = (
    "int grade(int s) {\n"
    "    int g = 0;\n"
    "    switch (s) {\n"
    "    case 1:\n"
    "        g = 10;\n"
    "        break;\n"
    "    case 2:\n"
    "        g = 20;\n"
    "        break;\n"
    "    default:\n"
    "        g = -1;\n"
    "        break;\n"
    "    }\n"
    "    return g;\n"
    "}\n"
    "int main() { return grade(1); }\n"
)

SRC_DO_WHILE = (
    "int count(int n) {\n"
    "    int i = 0;\n"
    "    do\n"
    "        i = i + 1;\n"
    "    while (i < n);\n"
    "    return i;\n"
    "}\n"
    "int main() { return count(3); }\n"
)

SRC_TRY_CATCH = (
    "#include <stdexcept>\n"
    "int risky(int x) {\n"
    "    int y = 0;\n"
    "    try {\n"
    "        y = x + 1;\n"
    "    } catch (const std::exception& e) {\n"
    "        y = -1;\n"
    "    }\n"
    "    return y;\n"
    "}\n"
    "int main() { return risky(1); }\n"
)

SRC_LAMBDA = (
    "int run() {\n"
    "    auto f = [](int v) {\n"
    "        int w = v + 1;\n"
    "        return w;\n"
    "    };\n"
    "    int r = f(3);\n"
    "    return r;\n"
    "}\n"
    "int main() { return run(); }\n"
)

SRC_RANGE_FOR = (
    "#include <vector>\n"
    "int sumv(std::vector<int> v) {\n"
    "    int s = 0;\n"
    "    for (int x : v)\n"
    "        s = s + x;\n"
    "    return s;\n"
    "}\n"
    "int main() { return sumv({1, 2, 3}); }\n"
)

SRC_CLASS_TEMPLATE = (
    "template <typename T>\n"
    "class Box {\n"
    "public:\n"
    "    T value;\n"
    "    T get() {\n"
    "        T tmp = value;\n"
    "        return tmp;\n"
    "    }\n"
    "    void set(T v) {\n"
    "        value = v;\n"
    "    }\n"
    "};\n"
    "int main() {\n"
    "    Box<int> b;\n"
    "    b.set(3);\n"
    "    int x = b.get();\n"
    "    return x;\n"
    "}\n"
)

SRC_NESTED_LOOPS = (
    "int nest(int n) {\n"
    "    int s = 0;\n"
    "    for (int i = 0; i < n; i++) {\n"
    "        for (int j = 0; j < n; j++) {\n"
    "            s = s + i + j;\n"
    "        }\n"
    "    }\n"
    "    return s;\n"
    "}\n"
    "int main() { return nest(2); }\n"
)


def _syntax_only(source: str) -> tuple[int, str]:
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        src = tmp_path / "prog.cpp"
        src.write_text(source)
        shutil.copy(TRACER_H, tmp_path / "tracer.h")
        result = subprocess.run(
            ["g++", "-fsyntax-only", "-std=c++17", "-I", str(tmp_path), str(src)],
            capture_output=True,
            text=True,
            check=False,
        )
        return result.returncode, result.stderr


def _walk_and_instrument(src_text: str, tmp_path: Path, name: str):
    src = tmp_path / name
    src.write_text(src_text)
    try:
        result = walk(str(src))
    except InstrumentParseError as e:
        raise AssertionError(f"walk raised InstrumentParseError: {e}")
    instrumented = instrument(src_text, str(src))
    scopes = build_scope_map(str(src))
    return result, instrumented, scopes


class TestInstrumenterMatrix:
    def test_braceless_if_elseif_chain(self, tmp_path):
        result, instrumented, _ = _walk_and_instrument(SRC_BRACELESS_IF, tmp_path, "m_if.cpp")
        branches = [p for p in result.injection_points if p.kind == InjectKind.BRANCH]
        assert len(branches) >= 1  # top if only; else-if skipped to preserve chain
        states = {p.line for p in result.injection_points if p.kind == InjectKind.STATE}
        assert 3 in states and 5 in states and 7 in states  # each braceless body has STATE
        assert "{" not in instrumented.split("if (x > 0)")[1].split("\n")[0]  # no brace-wrap
        code, err = _syntax_only(instrumented)
        assert code == 0, f"braceless-if not syntax-clean:\n{err}"

    def test_switch_case_default(self, tmp_path):
        result, instrumented, _ = _walk_and_instrument(SRC_SWITCH, tmp_path, "m_sw.cpp")
        branches = [p for p in result.injection_points if p.kind == InjectKind.BRANCH]
        assert len(branches) >= 3  # case 1, case 2, default
        code, err = _syntax_only(instrumented)
        assert code == 0, f"switch not syntax-clean:\n{err}"

    def test_do_while_braceless(self, tmp_path):
        result, instrumented, scopes = _walk_and_instrument(SRC_DO_WHILE, tmp_path, "m_do.cpp")
        iters = [p for p in result.injection_points if p.kind == InjectKind.LOOP_ITER]
        assert not iters  # skip-not-brace-wrap: braceless body gets no LOOP_ITER
        states = {p.line for p in result.injection_points if p.kind == InjectKind.STATE}
        assert 4 in states  # braceless do body line carries STATE (parity with for/while)
        assert "count" in scopes
        # Injector skip-with-reason: any splice splits `do <body> while (...)`.
        assert "__TRACE_STATE(4," not in instrumented
        assert "__TRACE_STATE(3," not in instrumented
        code, err = _syntax_only(instrumented)
        assert code == 0, f"do-while not syntax-clean:\n{err}"

    def test_try_catch_bodies_recurse(self, tmp_path):
        result, instrumented, _ = _walk_and_instrument(SRC_TRY_CATCH, tmp_path, "m_try.cpp")
        states = {p.line for p in result.injection_points if p.kind == InjectKind.STATE}
        assert 5 in states  # try body statement recursed like COMPOUND
        assert 7 in states  # catch body statement recursed like COMPOUND
        code, err = _syntax_only(instrumented)
        assert code == 0, f"try/catch not syntax-clean:\n{err}"

    def test_lambda_body_recurses(self, tmp_path):
        result, instrumented, _ = _walk_and_instrument(SRC_LAMBDA, tmp_path, "m_lam.cpp")
        states = {p.line for p in result.injection_points if p.kind == InjectKind.STATE}
        assert 3 in states  # lambda body statement recursed like COMPOUND
        code, err = _syntax_only(instrumented)
        assert code == 0, f"lambda not syntax-clean:\n{err}"

    def test_range_for_braceless(self, tmp_path):
        result, instrumented, scopes = _walk_and_instrument(SRC_RANGE_FOR, tmp_path, "m_rf.cpp")
        iters = [p for p in result.injection_points if p.kind == InjectKind.LOOP_ITER]
        assert not iters  # braceless: skip LOOP_ITER, STATE only
        states = {p.line for p in result.injection_points if p.kind == InjectKind.STATE}
        assert 5 in states
        assert "sumv" in scopes
        code, err = _syntax_only(instrumented)
        assert code == 0, f"range-for not syntax-clean:\n{err}"

    def test_class_template_skip_with_reason(self, tmp_path):
        _result, instrumented, scopes = _walk_and_instrument(
            SRC_CLASS_TEMPLATE, tmp_path, "m_ct.cpp"
        )
        assert "Box" not in scopes and "get" not in scopes and "set" not in scopes
        lines = instrumented.splitlines()
        open_idx = next(i for i, l in enumerate(lines) if "class Box" in l)
        close_idx = next(i for i, l in enumerate(lines) if l.strip() == "};")
        inside = [l for i, l in enumerate(lines) if open_idx < i < close_idx and "__TRACE" in l]
        assert not inside  # skip-with-reason: no TRACE inside class-template definition
        assert '"main"' in instrumented
        code, err = _syntax_only(instrumented)
        assert code == 0, f"class-template not syntax-clean:\n{err}"

    def test_nested_loops(self, tmp_path):
        result, instrumented, _ = _walk_and_instrument(SRC_NESTED_LOOPS, tmp_path, "m_nl.cpp")
        iters = [
            p
            for p in result.injection_points
            if p.kind == InjectKind.LOOP_ITER and p.func_name == "nest"
        ]
        assert len(iters) == 2  # outer + inner braced loops
        states = {p.line for p in result.injection_points if p.kind == InjectKind.STATE}
        assert 5 in states  # innermost body statement has STATE
        code, err = _syntax_only(instrumented)
        assert code == 0, f"nested loops not syntax-clean:\n{err}"
