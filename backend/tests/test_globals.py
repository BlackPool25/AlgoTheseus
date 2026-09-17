"""
test_globals.py — T3: global-scope capture with change-dedup (RED-first).

- test_globals_captured_in_state: `const int N = 10;` visible in a main STATE.
- test_globals_dedup: identical snapshot resent nowhere (exactly one STATE carries "g").
- test_no_globals_key_without_globals: zero-globals program emits no "g" key at all.
- test_walker_collects_global_vars: TU-level VAR_DECLs land in WalkResult.global_vars.
"""

import json
import subprocess
import tempfile
from pathlib import Path

from app.core.instrumenter.ast_walker import walk

TRACER_H = Path(__file__).parent.parent / "app" / "core" / "instrumenter" / "tracer.h"


def _compile_and_run(source: str, stdin: str = "") -> tuple[str, str, int]:
    """Compile instrumented source and run it. Returns (stdout, stderr, exit_code)."""
    import shutil

    from app.core.instrumenter.injector import instrument

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        src = tmp_path / "prog.cpp"
        src.write_text(source)
        instrumented = instrument(src.read_text(), str(src))
        src.write_text(instrumented)
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
                str(src),
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        if compile_result.returncode != 0:
            return "", compile_result.stderr, compile_result.returncode

        run_result = subprocess.run(
            [str(binary)],
            input=stdin,
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
        return run_result.stdout, run_result.stderr, run_result.returncode


def _trace_events(stderr: str) -> list[dict]:
    events = []
    for line in stderr.splitlines():
        if line.startswith("TRACE:"):
            events.append(json.loads(line[len("TRACE:") :]))
    return events


GLOBALS_SRC = """\
const int N = 10;
const int M = 5;

int main() {
    int total = 0;
    int x = N + M;
    for (int i = 0; i < 3; i++) {
        total = total + x;
    }
    return 0;
}
"""

NO_GLOBALS_SRC = """\
int main() {
    int x = 1;
    int y = x + 2;
    return y;
}
"""


class TestWalkerGlobals:
    def test_walker_collects_global_vars(self, tmp_path):
        """TU-level `const int N` / `int total` land in WalkResult.global_vars."""
        src = tmp_path / "g.cpp"
        src.write_text(GLOBALS_SRC)
        result = walk(str(src))
        assert "N" in result.global_vars
        assert "M" in result.global_vars

    def test_walker_empty_globals_when_none(self, tmp_path):
        """A program with no globals reports an empty list (not None)."""
        src = tmp_path / "ng.cpp"
        src.write_text(NO_GLOBALS_SRC)
        result = walk(str(src))
        assert result.global_vars == []


class TestGlobalsTrace:
    def test_globals_captured_in_state(self):
        """Global `const int N = 10;` appears in a `main` STATE."""
        _, stderr, code = _compile_and_run(GLOBALS_SRC)
        events = _trace_events(stderr)
        assert code == 0, f"run failed:\n{stderr}"
        main_states = [e for e in events if e.get("t") == "state" and e.get("f") == "main"]
        assert main_states, "no main STATE events"
        with_g = [e for e in main_states if "g" in e]
        assert with_g, "no STATE carries globals"
        assert any(e["g"].get("N") == 10 for e in with_g)

    def test_globals_dedup(self):
        """An unchanged globals snapshot is emitted exactly once (bound trace size)."""
        _, stderr, code = _compile_and_run(GLOBALS_SRC)
        events = _trace_events(stderr)
        assert code == 0, f"run failed:\n{stderr}"
        main_states = [e for e in events if e.get("t") == "state" and e.get("f") == "main"]
        assert len(main_states) > 1, "need multiple STATEs to prove dedup"
        with_g = [e for e in main_states if "g" in e]
        assert len(with_g) == 1, f"expected exactly 1 STATE with globals, got {len(with_g)}"

    def test_no_globals_key_without_globals(self):
        """A program with zero globals emits NO `globals` key at all."""
        _, stderr, _ = _compile_and_run(NO_GLOBALS_SRC)
        events = _trace_events(stderr)
        assert events, "no trace events"
        assert all("g" not in e for e in events), "globals key leaked into zero-globals trace"
