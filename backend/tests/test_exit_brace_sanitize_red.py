"""test_exit_brace_sanitize_red.py — FUNC_EXIT trailing-brace + sanitizer strings.

P0-12 (Wave-0 task 19 BROKEN): FUNC_EXIT safe-expr rewrite replaces the whole
`return x;}` line with `return x;`, dropping the trailing `}` that closes the
function (g++ exit 1, function-definition-not-allowed-here).
P0-13 (Wave-0 task 20 BROKEN): `_sanitize_for_scan` splits `//` BEFORE blanking
string literals, so `"http://x"` truncates the scan line and the loop-governed
wrap corrupts the condition (g++ exit 1).

Tests 1-2 MUST FAIL on pre-fix code (compile breaks); the rest lock the
controls (normal returns unchanged, real `//` comments still strip).
"""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

from app.core.instrumenter.injector import _sanitize_for_scan, instrument

TRACER_H = Path(__file__).parent.parent / "app" / "core" / "instrumenter" / "tracer.h"

# P0-12 shape: return line itself starts with `return` and ends with `}`.
BRACE_SRC = (
    "#include <iostream>\n"
    "int x = 7;\n"
    "int f() {\n"
    "return x;}\n"
    "int main(){ std::cout << f() << std::endl; return 0; }\n"
)

# P0-13 shape: `//` inside a string on a loop-governed probed line.
GOV_SRC = (
    "#include <iostream>\n"
    "#include <string>\n"
    "#include <vector>\n"
    "int count_url(const std::vector<std::string>& v) {\n"
    "    int n = 0;\n"
    "    for (size_t i = 0; i < v.size(); ++i) {\n"
    '        if (v[i] == "http://x") n++;\n'
    "    }\n"
    "    return n;\n"
    "}\n"
    "int main() {\n"
    '    std::vector<std::string> v = {"http://x", "abc"};\n'
    "    std::cout << count_url(v) << std::endl;\n"
    "    return 0;\n"
    "}\n"
)

# Control: normal multi-line return must compile before and after.
NORMAL_SRC = (
    "#include <iostream>\n"
    "int f() {\n"
    "    return 42;\n"
    "}\n"
    "int main() {\n"
    "    std::cout << f() << std::endl;\n"
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


class TestExitBraceSanitize:
    def test_minified_return_brace_compiles(self, tmp_path: Path) -> None:
        """RED driver P0-12: `return x;}` must keep its trailing `}`."""
        src = tmp_path / "brace.cpp"
        src.write_text(BRACE_SRC)
        out = instrument(BRACE_SRC, str(src))
        code, stderr = _compile(out)
        assert code == 0, f"trailing `}}` dropped from FUNC_EXIT rewrite:\n{stderr}"

    def test_url_string_governed_compiles(self, tmp_path: Path) -> None:
        """RED driver P0-13: URL string under loop-governed wrap compiles."""
        src = tmp_path / "gov.cpp"
        src.write_text(GOV_SRC)
        out = instrument(GOV_SRC, str(src))
        code, stderr = _compile(out)
        assert code == 0, f"sanitizer split `//` inside string:\n{stderr}"

    def test_sanitizer_keeps_url_string(self) -> None:
        """Unit: `_sanitize_for_scan` must not truncate `"http://x"`."""
        out = _sanitize_for_scan('    std::string u = "http://x";')
        assert out == '    std::string u =           ;', f"got: {out!r}"

    def test_sanitizer_strips_real_comment(self) -> None:
        """Control: a real `//` comment still strips."""
        out = _sanitize_for_scan("    int x = 1; // set x")
        assert out == "    int x = 1; ", f"got: {out!r}"

    def test_normal_return_compiles(self, tmp_path: Path) -> None:
        """Control: normal multi-line return compiles."""
        src = tmp_path / "normal.cpp"
        src.write_text(NORMAL_SRC)
        out = instrument(NORMAL_SRC, str(src))
        code, stderr = _compile(out)
        assert code == 0, f"normal return broke:\n{stderr}"
