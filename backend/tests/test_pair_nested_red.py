"""
test_pair_nested_red.py — TDD red test for nested pair serialization.

``tracer.h`` defines ``__ser(pair)`` AFTER the ``vector<T>`` template, so the
dependent ``__ser(v[i])`` call inside ``vector<T>`` cannot see it (two-phase
lookup + no ADL into the global namespace for ``std::`` args). Instrumenting
any TU that traces ``vector<pair<...>>`` (e.g. the shipped Dijkstra template
with ``vector<vector<pair<int,int>>>`` adjacency lists) fails at g++ with
``no matching function for call to __ser(... pair ...)``.

ROUTE: real instrument → g++ → run path (not direct tracer.h inclusion).
"""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

from app.core.instrumenter.injector import instrument
from app.core.trace.parser import parse

TRACER_H = Path(__file__).parent.parent / "app" / "core" / "instrumenter" / "tracer.h"

_SRC = """\
#include <iostream>
#include <string>
#include <vector>
#include <utility>

int main() {
    std::vector<std::pair<int,int>> edges = {{1, 2}, {3, 4}};
    std::pair<std::string, std::vector<int>> labeled = {"ab", {5, 6}};
    std::vector<std::vector<std::pair<int,int>>> adj(1);
    adj[0].push_back({7, 8});
    std::cout << edges[0].first << ":" << labeled.first << ":" << adj[0][0].second << std::endl;
    return 0;
}
"""


def _instrument_compile_run(src: str) -> subprocess.CompletedProcess:
    instrumented = instrument(src)
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        (tmp_path / "prog.cpp").write_text(instrumented)
        shutil.copy(TRACER_H, tmp_path / "tracer.h")
        binary = tmp_path / "prog"
        compile_result = subprocess.run(
            ["g++", "-O0", "-std=c++17", "-I", str(tmp_path),
             "-o", str(binary), str(tmp_path / "prog.cpp")],
            capture_output=True, text=True, timeout=60, check=False,
        )
        assert compile_result.returncode == 0, (
            f"compile error:\n{compile_result.stderr}"
        )
        # Binary path is temp-dir local; run inside the context before cleanup.
        # To return the result, run here and capture output.
        proc = subprocess.run(
            [str(binary)], capture_output=True, text=True, timeout=10, check=False,
        )
        # NOTE: binary is deleted with tmp dir; stash outputs on the result.
        proc.binary_stdout = proc.stdout  # type: ignore[attr-defined]
        return proc


def test_nested_pair_instrumented_end_to_end():
    """vector<pair> + pair<string,vector<int>> + vector<vector<pair>> must
    instrument, compile (exit 0), print stdout, and emit >=1 trace event."""
    proc = _instrument_compile_run(_SRC)
    assert proc.returncode == 0, f"nonzero exit:\n{proc.stderr}"
    assert proc.stdout.strip() == "1:ab:8", f"bad stdout: {proc.stdout!r}"
    raw = [ln[len("TRACE:"):] for ln in proc.stderr.splitlines()
           if ln.startswith("TRACE:")]
    assert raw, "no TRACE: lines produced"
    events = parse(raw)
    assert len(events) > 0, "parser produced zero events"
