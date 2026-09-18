"""test_return_substring_red.py — word-boundary return guard in STATE placement.

Substring test `"return" in line_text` misfires on identifiers like
`returned`, so a STATE probe gets placed BEFORE `int returned = 5;`
(leaving the snapshot-less/compile-break path) instead of AFTER it.
The guard must use word-boundary matching (`\\breturn\\b`) after stripping
string literals FIRST, then `//` comments — self-sufficient, independent
of `_sanitize_for_scan` (todo 6 owns it; still BROKEN per Wave-0 P0-13).

Test 1 MUST FAIL on pre-fix code (file-level RED with
`'returned' was not declared` from g++); the rest lock the guard
behaviour (URL-string edge + real-return snapshot preserved).
"""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

from app.core.instrumenter.injector import instrument

TRACER_H = Path(__file__).parent.parent / "app" / "core" / "instrumenter" / "tracer.h"

# Happy path: `returned` is an identifier, not the `return` keyword.
HAPPY_SRC = (
    "#include <iostream>\n"
    "int main() {\n"
    "    int returned = 5;\n"
    "    int y = returned;\n"
    "    std::cout << y << std::endl;\n"
    "    return 0;\n"
    "}\n"
)

# Edge: URL string holds `//` — guard must strip strings before `//` split.
URL_SRC = (
    "#include <iostream>\n"
    "#include <string>\n"
    "int main() {\n"
    '    std::string u = "http://x";\n'
    "    std::cout << u << std::endl;\n"
    "    return 0;\n"
    "}\n"
)

# Real return must still get its end-of-line snapshot (before-placement).
REAL_RETURN_SRC = (
    "#include <iostream>\n"
    "int f(int x) {\n"
    "    int y = x + 1;\n"
    "    return y;\n"
    "}\n"
    "int main() {\n"
    "    std::cout << f(41) << std::endl;\n"
    "    return 0;\n"
    "}\n"
)


def _compile(source: str) -> tuple[int, str]:
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        src = tmp_path / "prog.cpp"
        src.write_text(source)
        shutil.copy(TRACER_H, tmp_path / "tracer.h")
        binary = tmp_path / "prog"
        result = subprocess.run(
            ["g++", "-O0", "-std=c++17", "-I", str(tmp_path),
             "-o", str(binary), str(src)],
            capture_output=True, text=True, check=False,
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
            ["g++", "-O0", "-std=c++17", "-I", str(tmp_path),
             "-o", str(binary), str(src)],
            capture_output=True, text=True, check=False,
        )
        if comp.returncode != 0:
            return comp.returncode, "", comp.stderr
        run = subprocess.run([str(binary)], capture_output=True, text=True, check=False)
        return run.returncode, run.stdout, run.stderr


class TestReturnSubstring:
    def test_returned_identifier_compiles(self, tmp_path: Path) -> None:
        """RED driver: HEAD treats `int returned = 5;` as a return line —
        g++ rejects with `'returned' was not declared in this scope`."""
        src = tmp_path / "ret.cpp"
        src.write_text(HAPPY_SRC)
        out = instrument(HAPPY_SRC, str(src))
        code, stderr = _compile(out)
        assert code == 0, f"identifier `returned` misclassified as return:\n{stderr}"

    def test_returned_identifier_runs(self, tmp_path: Path) -> None:
        """Instrumented happy-path binary runs and prints 5."""
        src = tmp_path / "ret2.cpp"
        src.write_text(HAPPY_SRC)
        out = instrument(HAPPY_SRC, str(src))
        code, stdout, stderr = _compile_and_run(out)
        assert code == 0, f"instrumented binary failed to run:\n{stderr}"
        assert "5" in stdout, f"expected `5` in stdout, got: {stdout!r}"

    def test_url_string_compiles(self, tmp_path: Path) -> None:
        """Edge: `std::string u = \"http://x\";` still compiles — the guard
        strips string literals before the `//` comment split."""
        src = tmp_path / "url.cpp"
        src.write_text(URL_SRC)
        out = instrument(URL_SRC, str(src))
        code, stderr = _compile(out)
        assert code == 0, f"URL-string line broke instrumentation:\n{stderr}"

    def test_real_return_snapshot_preserved(self, tmp_path: Path) -> None:
        """Real `return y;` still gets its end-of-line snapshot (before-placement)."""
        src = tmp_path / "real.cpp"
        src.write_text(REAL_RETURN_SRC)
        out = instrument(REAL_RETURN_SRC, str(src))
        lines = out.splitlines()
        ret_idx = next(i for i, ln in enumerate(lines) if ln.strip().startswith("return y;"))
        before = lines[max(0, ret_idx - 3):ret_idx]
        assert any("__TRACE_STATE" in ln or "__TRACE_FUNC_EXIT" in ln for ln in before), (
            f"real return lost its snapshot; lines before return: {before}"
        )
        code, stderr = _compile(out)
        assert code == 0, f"real-return program failed to compile:\n{stderr}"
