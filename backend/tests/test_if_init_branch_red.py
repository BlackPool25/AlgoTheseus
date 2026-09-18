"""test_if_init_branch_red.py — skip BRANCH probe for if-init declarations.

An if header with an init-statement (`if (int y = x*2; y > 3)`) splices the
declaration text as a C++ expression into `__TRACE_BRANCH`, so g++ rejects
the instrumented program with `expected primary-expression before 'int'`.
The walker must detect the init-declaration (children[0]-is-declaration)
and emit a constant-true branch probe instead — branch events stay, the
declaration is never re-spliced as an expression.

Test 1 MUST FAIL on pre-fix code (file-level RED with the
`expected primary-expression` excerpt from g++); the rest lock the fix
(map-lookup variant + pure-condition control unchanged).
"""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

from app.core.instrumenter.injector import instrument

TRACER_H = Path(__file__).parent.parent / "app" / "core" / "instrumenter" / "tracer.h"

# Happy path: init-statement declares `y`, condition uses it.
HAPPY_SRC = (
    "#include <iostream>\n"
    "int main() {\n"
    "    int x = 5;\n"
    "    if (int y = x * 2; y > 3) {\n"
    '        std::cout << "big " << y << std::endl;\n'
    "    } else {\n"
    '        std::cout << "small" << std::endl;\n'
    "    }\n"
    "    return 0;\n"
    "}\n"
)

# Failure variant: map lookup with `auto` init-declaration must also compile.
MAP_SRC = (
    "#include <iostream>\n"
    "#include <map>\n"
    "int main() {\n"
    "    std::map<int, int> m{{1, 10}, {2, 20}};\n"
    "    if (auto it = m.find(1); it != m.end()) {\n"
    '        std::cout << "found " << it->second << std::endl;\n'
    "    } else {\n"
    '        std::cout << "missing" << std::endl;\n'
    "    }\n"
    "    return 0;\n"
    "}\n"
)

# Control: pure conditions keep the legacy spliced probe (byte-identical).
PURE_SRC = (
    "#include <iostream>\n"
    "int main() {\n"
    "    int x = 5;\n"
    "    if (x > 3) {\n"
    '        std::cout << "big" << std::endl;\n'
    "    }\n"
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


class TestIfInitBranch:
    def test_if_init_compiles(self, tmp_path: Path) -> None:
        """RED driver: HEAD splices `int y = ...` as an expression — g++
        rejects with `expected primary-expression before 'int'`."""
        src = tmp_path / "init.cpp"
        src.write_text(HAPPY_SRC)
        out = instrument(HAPPY_SRC, str(src))
        code, stderr = _compile(out)
        assert code == 0, f"if-init declaration spliced as expression:\n{stderr}"

    def test_if_init_runs_with_branch_events(self, tmp_path: Path) -> None:
        """Instrumented happy-path binary runs, prints `big 10`, and still
        emits a branch probe with a constant condition."""
        src = tmp_path / "init2.cpp"
        src.write_text(HAPPY_SRC)
        out = instrument(HAPPY_SRC, str(src))
        assert "__TRACE_BRANCH" in out, "branch probe missing for if-init header"
        code, stdout, stderr = _compile_and_run(out)
        assert code == 0, f"instrumented binary failed to run:\n{stderr}"
        assert "big 10" in stdout, f"expected `big 10` in stdout, got: {stdout!r}"

    def test_map_lookup_init_compiles_and_runs(self, tmp_path: Path) -> None:
        """`if (auto it = m.find(1); …)` variant compiles and finds the key."""
        src = tmp_path / "mapinit.cpp"
        src.write_text(MAP_SRC)
        out = instrument(MAP_SRC, str(src))
        code, stdout, stderr = _compile_and_run(out)
        assert code == 0, f"map-lookup if-init failed:\n{stderr}"
        assert "found 10" in stdout, f"expected `found 10` in stdout, got: {stdout!r}"

    def test_pure_condition_probe_unchanged(self, tmp_path: Path) -> None:
        """Control: pure `if (x > 3)` keeps the legacy spliced condition."""
        src = tmp_path / "pure.cpp"
        src.write_text(PURE_SRC)
        out = instrument(PURE_SRC, str(src))
        assert "(x > 3)" in out, f"pure-condition probe changed; instrumented:\n{out}"
        code, stderr = _compile(out)
        assert code == 0, f"pure-condition program broke:\n{stderr}"
