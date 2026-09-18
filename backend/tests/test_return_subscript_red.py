"""test_return_subscript_red.py — mutating return subscripts (P1-03).

P1-03: `return a[i++]` is classified safe by `_is_safe_return_expr`
(injector.py), so the safe path duplicates the expression — once for
`__TRACE_FUNC_EXIT`, once for the actual `return` — and `i++` runs twice.
Observed on HEAD: function returns `a[1]` (20, not 10) and `i` ends at 2.

Fix (mandated): tighten `_is_safe_return_expr` to reject bracket chains
containing `++`, `--`, or `=` (assignments), so mutating subscripts take
the temp path (`{ auto&& __algotrace_ret_N = (expr); ... }`) and evaluate
once. Pure `a[i]` / `p.x[0]` stay on the safe path.

Test 1 MUST FAIL on pre-fix code (stdout `20 2` double-eval); the rest
lock the controls (pure subscripts still safe-path, classifier unit pins).
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from pathlib import Path

from app.core.instrumenter.injector import _is_safe_return_expr, instrument

TRACER_H = Path(__file__).parent.parent / "app" / "core" / "instrumenter" / "tracer.h"

# P1-03 shape: post-increment inside the subscript mutates on evaluation.
MUTATING_SRC = (
    "#include <iostream>\n"
    "int a[3] = {10, 20, 30};\n"
    "int i = 0;\n"
    "int f() {\n"
    "    return a[i++];\n"
    "}\n"
    "int main() { int r = f(); std::cout << r << \" \" << i << std::endl; return 0; }\n"
)

# Control: pure subscript — safe path, duplicated eval is harmless.
PURE_SRC = (
    "#include <iostream>\n"
    "int a[3] = {10, 20, 30};\n"
    "int i = 0;\n"
    "int f() {\n"
    "    return a[i];\n"
    "}\n"
    "int main() { int r = f(); std::cout << r << \" \" << i << std::endl; return 0; }\n"
)

# Control: pure member chain with subscript — safe path.
MEMBER_SRC = (
    "#include <iostream>\n"
    "struct P { int x[2]; };\n"
    "P p = {{7, 8}};\n"
    "int f() {\n"
    "    return p.x[0];\n"
    "}\n"
    "int main() { std::cout << f() << std::endl; return 0; }\n"
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


def _instrument(src_text: str, name: str, tmp_path: Path) -> str:
    src = tmp_path / name
    src.write_text(src_text)
    return instrument(src_text, str(src))


def _exit_values(events: list[dict], func: str) -> list:
    return [e["r"] for e in events if e.get("t") == "exit" and e.get("f") == func]


class TestReturnSubscript:
    def test_mutating_subscript_evaluates_once(self, tmp_path: Path) -> None:
        """RED driver P1-03: `return a[i++]` must evaluate once (stdout `10 1`)."""
        out = _instrument(MUTATING_SRC, "mut.cpp", tmp_path)
        code, stderr, stdout, events = _compile_and_run(out)
        assert code == 0, f"mutating return broke:\n{stderr}"
        assert stdout == "10 1", f"double-eval: got {stdout!r}, want '10 1'"
        assert _exit_values(events, "f") == [10]

    def test_mutating_subscript_takes_temp_path(self, tmp_path: Path) -> None:
        """Emission lock: mutating subscript must go through the temp bind."""
        out = _instrument(MUTATING_SRC, "mut_emit.cpp", tmp_path)
        assert "__algotrace_ret_" in out, "mutating subscript must take the temp path"

    def test_pure_subscript_stays_safe_path(self, tmp_path: Path) -> None:
        """Control: pure `a[i]` still on the safe path (no temp, correct run)."""
        assert _is_safe_return_expr("a[i]")
        out = _instrument(PURE_SRC, "pure.cpp", tmp_path)
        assert "__algotrace_ret_" not in out, "pure subscript must stay on safe path"
        code, stderr, stdout, events = _compile_and_run(out)
        assert code == 0, f"pure return broke:\n{stderr}"
        assert stdout == "10 0", f"wrong stdout: {stdout!r}"
        assert _exit_values(events, "f") == [10]

    def test_pure_member_chain_stays_safe_path(self, tmp_path: Path) -> None:
        """Control: pure `p.x[0]` still on the safe path (no temp, correct run)."""
        assert _is_safe_return_expr("p.x[0]")
        out = _instrument(MEMBER_SRC, "member.cpp", tmp_path)
        assert "__algotrace_ret_" not in out, "pure member chain must stay on safe path"
        code, stderr, stdout, events = _compile_and_run(out)
        assert code == 0, f"member return broke:\n{stderr}"
        assert stdout == "7", f"wrong stdout: {stdout!r}"
        assert _exit_values(events, "f") == [7]

    def test_classifier_rejects_mutations(self) -> None:
        """Unit pins: mutating brackets unsafe, pure shapes safe."""
        assert not _is_safe_return_expr("a[i++]")
        assert not _is_safe_return_expr("a[++i]")
        assert not _is_safe_return_expr("a[i--]")
        assert not _is_safe_return_expr("a[i = 0]")
        assert not _is_safe_return_expr("a[i += 1]")
        assert _is_safe_return_expr("a[i]")
        assert _is_safe_return_expr("a[0]")
        assert _is_safe_return_expr("p.x[0]")
