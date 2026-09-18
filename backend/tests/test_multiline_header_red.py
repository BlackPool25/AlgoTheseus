"""test_multiline_header_red.py — P0-02/P0-03: multi-line loop/if headers.

_loop_governed_if (injector.py) matches `for (...)` headers on a single
line only, so a multi-line for-header with a same-line `if` falls back to
before-placement outside the loop scope → g++ `'i' was not declared in
this scope` (P0-02).

_is_braceless_then_body / the else-guard only inspect the previous
single line, so a multi-line `if (a &&\\n b)` condition hides the header
and a probe splices between header and body → g++ `'else' without a
previous 'if'` (P0-03).

Both RED drivers MUST FAIL on pre-fix code; the rest lock placement,
runtime output, and branch taken flags.
"""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

from app.core.instrumenter.injector import instrument

TRACER_H = Path(__file__).parent.parent / "app" / "core" / "instrumenter" / "tracer.h"

# P0-02: multi-line for-header, `if` on the header's last line.
MULTILINE_FOR_SRC = (
    "#include <bits/stdc++.h>\n"
    "using namespace std;\n"
    "int main() {\n"
    "    vector<int> indeg = {0, 1, 0};\n"
    "    int n = (int)indeg.size();\n"
    "    for (int i = 0;\n"
    "         i < n; ++i) if (indeg[i] == 0) indeg[i] = 1;\n"
    "    cout << indeg[0] << indeg[1] << indeg[2] << '\\n';\n"
    "    return 0;\n"
    "}\n"
)

# P0-03: multi-line if-condition with braceless body + else.
MULTILINE_IF_ELSE_SRC = (
    "#include <bits/stdc++.h>\n"
    "using namespace std;\n"
    "int main() {\n"
    "    int a = 2, b = 3;\n"
    "    if (a > 0 &&\n"
    "        b > 0)\n"
    "        cout << \"both\\n\";\n"
    "    else\n"
    "        cout << \"other\\n\";\n"
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


class TestMultilineHeader:
    def test_multiline_for_governed_if_compiles(self, tmp_path: Path) -> None:
        """RED driver P0-02: probe must stay inside the loop scope."""
        src = tmp_path / "mlfor.cpp"
        src.write_text(MULTILINE_FOR_SRC)
        out = instrument(MULTILINE_FOR_SRC, str(src))
        code, stderr = _compile(out)
        assert code == 0, f"multi-line for-governed if failed to compile:\n{stderr}"

    def test_multiline_if_else_compiles(self, tmp_path: Path) -> None:
        """RED driver P0-03: probe must not orphan the else."""
        src = tmp_path / "mlif.cpp"
        src.write_text(MULTILINE_IF_ELSE_SRC)
        out = instrument(MULTILINE_IF_ELSE_SRC, str(src))
        code, stderr = _compile(out)
        assert code == 0, f"multi-line if/else failed to compile:\n{stderr}"

    def test_multiline_for_probe_inside_loop(self, tmp_path: Path) -> None:
        """No bare BRANCH probe for the governed if may precede the loop."""
        src = tmp_path / "mlfor2.cpp"
        src.write_text(MULTILINE_FOR_SRC)
        out = instrument(MULTILINE_FOR_SRC, str(src))
        bare = [
            ln for ln in out.splitlines()
            if ln.strip().startswith("__TRACE_BRANCH_OPS") and "indeg[i] == 0" in ln
        ]
        assert not bare, f"probe leaked outside loop scope: {bare}"

    def test_multiline_for_runs_with_both_taken_flags(self, tmp_path: Path) -> None:
        """indeg {0,1,0} → `111`; branch fires taken and untaken."""
        src = tmp_path / "mlfor3.cpp"
        src.write_text(MULTILINE_FOR_SRC)
        out = instrument(MULTILINE_FOR_SRC, str(src))
        code, stdout, stderr = _compile_and_run(out)
        assert code == 0, f"instrumented multi-line-for binary failed:\n{stderr}"
        assert "111" in stdout, f"wrong stdout: {stdout!r}"
        assert '"t":"branch"' in stderr, "expected branch events in trace output"
        assert '"tk":true' in stderr, "expected a taken branch event"
        assert '"tk":false' in stderr, "expected an untaken branch event"

    def test_multiline_if_else_runs_correct_stdout(self, tmp_path: Path) -> None:
        """a=2,b=3 → `both`; branch taken flag true."""
        src = tmp_path / "mlif2.cpp"
        src.write_text(MULTILINE_IF_ELSE_SRC)
        out = instrument(MULTILINE_IF_ELSE_SRC, str(src))
        code, stdout, stderr = _compile_and_run(out)
        assert code == 0, f"instrumented multi-line-if binary failed:\n{stderr}"
        assert "both" in stdout, f"wrong stdout: {stdout!r}"
        assert '"t":"branch"' in stderr, "expected branch events in trace output"
        assert '"tk":true' in stderr, "expected the taken branch event"
