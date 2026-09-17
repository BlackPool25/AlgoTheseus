"""
test_token_fallback_red.py — Wave 2b RED: guarded token fallback for
UNEXPOSED/macro nodes (+ class-template member bogus splice).

(i)  Macro fixture: `#define INC(x) ((x)+1)` used in main. instrument()
     must not crash, must compile+run, and the macro *definition* line
     must never get its own TRACE.
(ii) UNEXPOSED/class-template member fixture: multiline members of a
     class template. instrument() must not crash, must be syntax-clean,
     and no __TRACE may be spliced inside the template definition.
(iii) Fallback helpers: ast_walker._safe_get_tokens + _fallback_user_lines
     must exist and never raise (ImportError/AttributeError == RED).

Pre-fix these FAIL (bogus TRACE inside `class Box`, missing helpers).
Post-fix all PASS. Keep-as-is after GREEN.
"""

import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest

from app.core.instrumenter import ast_walker
from app.core.instrumenter.injector import instrument

TRACER_H = Path(__file__).parent.parent / "app" / "core" / "instrumenter" / "tracer.h"

MACRO_SRC = (
    "#define INC(x) ((x)+1)\n"
    "#include <iostream>\n"
    "int main() {\n"
    "    int a = 1;\n"
    "    int b = INC(a);\n"
    "    std::cout << b << std::endl;\n"
    "    return 0;\n"
    "}\n"
)

TEMPLATE_SRC = (
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


def _compile_and_run(source: str) -> tuple[int, str, str]:
    """Compile instrumented source and run it. Returns (rc, stdout, stderr)."""
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        src = tmp_path / "prog.cpp"
        src.write_text(source)
        shutil.copy(TRACER_H, tmp_path / "tracer.h")
        binary = tmp_path / "prog"
        comp = subprocess.run(
            [
                "g++",
                "-O0",
                "-std=c++17",
                "-I",
                str(tmp_path),
                "-o",
                str(binary),
                str(src),
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        if comp.returncode != 0:
            return comp.returncode, "", comp.stderr
        run = subprocess.run([str(binary)], capture_output=True, text=True, check=False)
        return run.returncode, run.stdout, run.stderr


def _syntax_only(source: str) -> tuple[int, str]:
    """g++ -fsyntax-only check. Returns (returncode, stderr)."""
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


class TestMacroTokenFallback:
    def test_macro_use_no_crash_compiles_runs(self, tmp_path):
        src = tmp_path / "macro.cpp"
        src.write_text(MACRO_SRC)
        instrumented = instrument(MACRO_SRC, str(src))  # must not raise
        rc, out, err = _compile_and_run(instrumented)
        assert rc == 0, f"macro-user instrumented source failed: rc={rc} err={err}"
        assert "2" in out, f"expected program output '2', got {out!r}"

    def test_macro_body_never_gets_own_trace(self, tmp_path):
        src = tmp_path / "macro.cpp"
        src.write_text(MACRO_SRC)
        instrumented = instrument(MACRO_SRC, str(src))
        bad = [
            ln
            for ln in instrumented.splitlines()
            if "__TRACE" in ln
            and (
                "__TRACE_FUNC_ENTER(1," in ln
                or "__TRACE_STATE(1," in ln
                or "__TRACE_BRANCH(1," in ln
            )
        ]
        assert not bad, f"TRACE spliced for macro-definition line 1:\n" + "\n".join(bad)
        assert "#define INC(x) ((x)+1)" in instrumented


class TestTemplateMemberFallback:
    def test_no_trace_inside_class_template(self, tmp_path):
        src = tmp_path / "tmpl.cpp"
        src.write_text(TEMPLATE_SRC)
        instrumented = instrument(TEMPLATE_SRC, str(src))  # must not raise
        lines = instrumented.splitlines()
        open_idx = next(i for i, l in enumerate(lines) if "class Box" in l)
        close_idx = next(i for i, l in enumerate(lines) if l.strip() == "};")
        inside = [
            f"instr-line {i + 1}: {l.strip()}"
            for i, l in enumerate(lines)
            if open_idx < i < close_idx and "__TRACE" in l
        ]
        assert (
            not inside
        ), "bogus splice: __TRACE inside class-template definition:\n" + "\n".join(
            inside
        )

    def test_template_instrumented_syntax_clean_and_main_traced(self, tmp_path):
        src = tmp_path / "tmpl.cpp"
        src.write_text(TEMPLATE_SRC)
        instrumented = instrument(TEMPLATE_SRC, str(src))
        code, stderr = _syntax_only(instrumented)
        assert code == 0, f"template instrumented source not syntax-clean:\n{stderr}"
        assert "__TRACE_FUNC_ENTER" in instrumented and '"main"' in instrumented


class TestFallbackHelpersGuarded:
    def test_safe_get_tokens_never_raises_on_macro_tu(self, tmp_path):
        assert hasattr(ast_walker, "_safe_get_tokens"), "missing _safe_get_tokens (RED)"
        assert hasattr(
            ast_walker, "_fallback_user_lines"
        ), "missing _fallback_user_lines (RED)"
        import clang.cindex as clang
        from app.core.instrumenter import _libclang_compat

        _libclang_compat.ensure_libclang()
        src = tmp_path / "macro.cpp"
        src.write_text(MACRO_SRC)
        idx = clang.Index.create()
        tu = idx.parse(str(src), args=_libclang_compat.default_extra_args())

        seen: list[tuple[str, int]] = []

        def visit(cursor: clang.Cursor) -> None:
            toks = ast_walker._safe_get_tokens(cursor)  # must never raise
            assert isinstance(toks, list)
            resolved = ast_walker._fallback_user_lines(cursor, str(src))  # never raises
            assert resolved is None or (
                isinstance(resolved, tuple)
                and len(resolved) == 2
                and all(isinstance(v, int) for v in resolved)
            )
            seen.append((str(cursor.kind), len(toks)))
            for ch in cursor.get_children():
                visit(ch)

        visit(tu.cursor)
        assert seen, "expected to visit at least the TU cursor"
