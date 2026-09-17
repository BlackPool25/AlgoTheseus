"""
test_branch_single_eval.py — Branch conditions must evaluate EXACTLY once.

Regression: the injector emitted `__TRACE_BRANCH_OPS(..., (COND), ...);`
BEFORE `if (COND)`, so a side-effecting condition (DSU unite, ++,
assignment, input reads) ran TWICE per check — the trace call mutated
state, the real `if` then saw the post-mutation value (Kruskal MST 0
instead of 19). Fix: hoist into a temp
(`auto __trace_c_N = (COND); __TRACE_BRANCH(..., __trace_c_N, ...);
if (__trace_c_N)`).
"""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest

from app.core.instrumenter.injector import instrument
from app.models.request import ExecuteRequest

TRACER_H = Path(__file__).parent.parent / "app" / "core" / "instrumenter" / "tracer.h"

ONCE_REPRO = """\
#include <iostream>
int n = 0;
bool once() { if (n > 0) return false; n++; return true; }
int main() { int m = 0; if (once()) m += 5; std::cout << m; return 0; }
"""

KRUSKAL_PATH = Path("/tmp/lldbg/kruskal.cpp")


def _load_kruskal() -> str:
    if not KRUSKAL_PATH.exists():
        pytest.skip(f"kruskal fixture absent: {KRUSKAL_PATH}")
    return KRUSKAL_PATH.read_text(encoding="utf-8")


def _compile_and_run(src: str, timeout: int = 15) -> subprocess.CompletedProcess:
    """Instrument → compile → run locally. Returns the run proc."""
    instrumented = instrument(src)
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        (tmp_path / "prog.cpp").write_text(instrumented)
        shutil.copy(TRACER_H, tmp_path / "tracer.h")
        binary = tmp_path / "prog"
        compile_result = subprocess.run(
            [
                "g++",
                "-O0",
                "-std=c++17",
                "-I",
                str(tmp_path),
                "-o",
                str(binary),
                str(tmp_path / "prog.cpp"),
            ],
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        assert compile_result.returncode == 0, f"compile error:\n{compile_result.stderr}"
        return subprocess.run(
            [str(binary)],
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )


def test_side_effecting_if_condition_evaluates_once():
    """Given if(once()) with stateful once() / When instrumented+run / Then m == 5."""
    proc = _compile_and_run(ONCE_REPRO)
    assert proc.returncode == 0, f"nonzero exit:\n{proc.stderr}"
    assert proc.stdout.strip() == "5", f"condition evaluated more than once, stdout={proc.stdout!r}"


async def test_kruskal_mst_weight_via_resolve(monkeypatch):
    """Given Kruskal / When _resolve (subprocess sandbox) / Then MST weight 19, exit 0."""
    import app.api.routes.execute as execute_mod

    monkeypatch.setenv("SANDBOX_MODE", "subprocess")
    req = ExecuteRequest(code=_load_kruskal(), raw_stdin="")
    resolved = await execute_mod._resolve(req, kind="single")
    assert resolved.run_result is not None
    assert resolved.run_result.exit_code == 0, (
        f"exit={resolved.run_result.exit_code} compile_error={resolved.run_result.compile_error}"
    )
    assert "MST weight: 19" in (resolved.run_result.stdout or ""), (
        f"stdout={resolved.run_result.stdout!r}"
    )
