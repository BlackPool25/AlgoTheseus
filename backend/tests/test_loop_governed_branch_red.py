"""test_loop_governed_branch_red.py — Bug-C: loop-governed braceless if.

The topo-sort preset holds `for (int i = 0; i < n; ++i) if (indeg[i] == 0) ...`.
A BRANCH probe placed BEFORE that line lands outside the for-init scope, so
g++ rejects the ops capture: `'i' was not declared in this scope`
(prog.cpp:26:94 via tracer.h:681). The injector must brace-wrap the
loop-governed if with the probe inside, keeping the loop var in scope.

Test 1 MUST FAIL on pre-fix code (file-level RED); the rest lock the
wrap behaviour (same-line + split-line + runtime trace).
"""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

from app.core.instrumenter.injector import instrument

TRACER_H = Path(__file__).parent.parent / "app" / "core" / "instrumenter" / "tracer.h"

# Minimal mirror of the topo-sort preset's Bug-C line (same-line for+if).
TOPO_SRC = (
    "#include <vector>\n"
    "#include <queue>\n"
    "#include <iostream>\n"
    "std::vector<int> topoSort(const std::vector<std::vector<int>>& g) {\n"
    "    int n = (int)g.size();\n"
    "    std::vector<int> indeg(n, 0);\n"
    "    for (int i = 0; i < n; ++i) if (indeg[i] == 0) indeg[i] = 1;\n"
    "    std::vector<int> order;\n"
    "    for (size_t k = 0; k < indeg.size(); ++k) if (indeg[k] == 1) order.push_back(k);\n"
    "    return order;\n"
    "}\n"
    "int main() {\n"
    "    std::vector<std::vector<int>> g(3);\n"
    "    g[0].push_back(1);\n"
    "    g[1].push_back(2);\n"
    "    std::vector<int> order = topoSort(g);\n"
    "    std::cout << order.size() << std::endl;\n"
    "    return 0;\n"
    "}\n"
)

SPLIT_SRC = (
    "#include <vector>\n"
    "std::vector<int> f(int n) {\n"
    "    std::vector<int> o;\n"
    "    for (int i = 0; i < n; ++i)\n"
    "        if (i % 2 == 0) o.push_back(i);\n"
    "    return o;\n"
    "}\n"
    "int main() { return (int)f(4).size(); }\n"
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


class TestLoopGovernedBranch:
    def test_topo_pattern_compiles(self, tmp_path: Path) -> None:
        """RED driver: HEAD emits the probe before the for line — g++
        rejects `i` (prog.cpp:26:94 `'i' was not declared in this scope`)."""
        src = tmp_path / "topo.cpp"
        src.write_text(TOPO_SRC)
        out = instrument(TOPO_SRC, str(src))
        code, stderr = _compile(out)
        assert code == 0, f"loop-governed branch failed to compile:\n{stderr}"

    def test_probe_wrapped_inside_loop(self, tmp_path: Path) -> None:
        """The ops probe for the topo line must sit inside the loop braces,
        never as a standalone line before the for header."""
        src = tmp_path / "topo2.cpp"
        src.write_text(TOPO_SRC)
        out = instrument(TOPO_SRC, str(src))
        wrapped = [ln for ln in out.splitlines()
                   if "for (int i = 0; i < n; ++i) {" in ln and "__TRACE_BRANCH_OPS" in ln]
        assert wrapped, "expected the for+if line brace-wrapped with the probe inside"
        bare = [ln for ln in out.splitlines()
                if ln.strip().startswith("__TRACE_BRANCH_OPS")
                and "indeg[i] == 0" in ln]
        assert not bare, f"probe leaked outside loop scope: {bare}"

    def test_split_line_governed_if_compiles(self, tmp_path: Path) -> None:
        """Bare `for (...)` header with the if on the next line compiles too."""
        src = tmp_path / "split.cpp"
        src.write_text(SPLIT_SRC)
        out = instrument(SPLIT_SRC, str(src))
        code, stderr = _compile(out)
        assert code == 0, f"split-line governed if failed to compile:\n{stderr}"

    def test_topo_trace_runs_with_branch_ops(self, tmp_path: Path) -> None:
        """Instrumented topo binary runs and reports the indeg branch with ops."""
        src = tmp_path / "topo3.cpp"
        src.write_text(TOPO_SRC)
        out = instrument(TOPO_SRC, str(src))
        code, _stdout, stderr = _compile_and_run(out)
        assert code == 0, f"instrumented topo binary failed to run:\n{stderr}"
        assert '"t":"branch"' in stderr, "expected branch events in trace output"
        assert "indeg[i] == 0" in stderr, "expected the topo branch condition traced"