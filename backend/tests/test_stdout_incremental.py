"""test_stdout_incremental.py — T7 adaptive cumulative stdout (engine-agnostic).

Protocol contract (see docs/trace-schema-v2.md + learnings for todo 19):
  - Tracer emits engine-agnostic `"o"` = bytes printed since the previous
    trace event (delta, JSON string). No Docker/WASM specifics on the wire.
  - Parser accumulates deltas into cumulative per-STATE `stdout`.
  - Adaptive granularity: <=2000 steps → every STATE carries stdout;
    >2000 steps → only loop-boundary STATEs carry it (others: None).
  - Per-event 64KB cap (UTF-8 code-point safe) + `stdout_truncated` flag.
"""

from __future__ import annotations

import asyncio
import json
import subprocess
import tempfile
from pathlib import Path

from app.core.trace.parser import parse

BACKEND = Path(__file__).parent.parent
TRACER_H = BACKEND / "app" / "core" / "instrumenter" / "tracer.h"

EXPECTED_OUTPUT = "".join(
    f"cout:{i}\nprintf:{i}\n" for i in range(5)
) + "done\n"


def _line(t, **kw):
    base = {"t": t, "l": 1, "f": "main", "d": 0}
    base.update(kw)
    return json.dumps(base)


class TestIncrementalAccumulation:
    def test_stdout_incremental_per_step(self):
        """Given STATE events with "o" deltas / When parsed /
        Then each STATE stdout is the cumulative output so far."""
        lines = [
            _line("enter", p={}),
            _line("state", v={}, o="cout:0\n"),
            _line("state", v={}, o="printf:0\n"),
            _line("state", v={}, o="cout:1\nprintf:1\n"),
            _line("exit", r=0),
        ]
        events = parse(lines)
        states = [e for e in events if e.type.value == "state"]
        assert [s.stdout for s in states] == [
            "cout:0\n",
            "cout:0\nprintf:0\n",
            "cout:0\nprintf:0\ncout:1\nprintf:1\n",
        ]
        assert all(s.stdout_truncated is False for s in states)

    def test_zero_byte_program_yields_empty_stdout_no_crash(self):
        """Given "o":"" deltas (printed nothing) / When parsed /
        Then stdout is "" (not None, no crash)."""
        lines = [
            _line("enter", p={}),
            _line("state", v={"x": 1}, o=""),
            _line("state", v={"x": 2}, o=""),
            _line("exit", r=0),
        ]
        events = parse(lines)
        states = [e for e in events if e.type.value == "state"]
        assert [s.stdout for s in states] == ["", ""]
        assert all(s.stdout_truncated is False for s in states)

    def test_absent_o_stays_none_v1_compat(self):
        """Given v1 lines without "o" / When parsed / Then stdout is None."""
        lines = [_line("enter", p={}), _line("state", v={}), _line("exit", r=0)]
        events = parse(lines)
        states = [e for e in events if e.type.value == "state"]
        assert [s.stdout for s in states] == [None]

    def test_64kb_cap_sets_truncated(self):
        """Given cumulative output > 64KB / When parsed /
        Then stdout is capped at 65536 bytes with stdout_truncated True."""
        big = "x" * 70000
        lines = [_line("enter", p={}), _line("state", v={}, o=big)]
        events = parse(lines)
        states = [e for e in events if e.type.value == "state"]
        assert len(states[0].stdout.encode("utf-8")) == 65536
        assert states[0].stdout_truncated is True
        assert states[0].stdout == "x" * 65536

    def test_adaptive_large_trace_loop_boundary_only(self):
        """Given >2000 steps / When parsed /
        Then only loop-boundary STATEs carry stdout, others omit (None)."""
        lines = [_line("enter", p={})]
        # 1005 iters × (iter + state) = 2010 steps + enter > 2000
        for i in range(1005):
            lines.append(_line("iter", it=i))
            lines.append(_line("state", v={"i": i}, o=f"{i}\n"))
        lines.append(_line("exit", r=0))
        events = parse(lines)
        assert len(events) > 2000
        states = [e for e in events if e.type.value == "state"]
        with_stdout = [s for s in states if s.stdout is not None]
        without = [s for s in states if s.stdout is None]
        # first/last-iteration neighbours + final state keep stdout; middle drops it
        assert len(with_stdout) >= 2
        assert len(without) > 0
        assert with_stdout[-1].stdout.endswith("1004\n")
        assert with_stdout[-1].stdout_truncated is False


def _instrumented_source() -> str:
    """Hand-instrumented print_loop body (injector lane untouched)."""
    # Strip includes/main wrapper; reuse only the loop print statements.
    return (
        '#include <cstdio>\n#include <iostream>\n#include "tracer.h"\n'
        "int main() {\n"
        '__TRACE_FUNC_ENTER(1, "main", 0);\n'
        "for (int i = 0; i < 5; ++i) {\n"
        '__TRACE_LOOP_ITER(2, "main", 0, i);\n'
        'std::cout << "cout:" << i << "\\n";\n'
        'printf("printf:%d\\n", i);\n'
        '__TRACE_STATE(5, "main", 0, "i", i);\n'
        "}\n"
        'std::cout << "done" << std::endl;\n'
        '__TRACE_STATE(8, "main", 0, "i", 5);\n'
        "int __trace_ret = 0;\n"
        '__TRACE_FUNC_EXIT(9, "main", 0, __trace_ret);\n'
        "return 0;\n}\n"
    )


def _run_gcc_local(src: str, workdir: Path) -> tuple[str, list[str]]:
    (workdir / "prog.cpp").write_text(src, encoding="utf-8")
    (workdir / "tracer.h").write_text(
        TRACER_H.read_text(encoding="utf-8"), encoding="utf-8"
    )
    subprocess.run(
        ["g++", "-O0", "-g", "-std=c++17", "-I", str(workdir),
         "-o", str(workdir / "prog"), str(workdir / "prog.cpp")],
        check=True, capture_output=True, text=True, timeout=120,
    )
    proc = subprocess.run(
        [str(workdir / "prog")], capture_output=True, text=True, timeout=30, check=False,
    )
    trace = [
        ln[len("TRACE:"):] for ln in proc.stderr.splitlines()
        if ln.startswith("TRACE:")
    ]
    return proc.stdout, trace


class TestEndToEndByteExact:
    def test_last_event_stdout_matches_terminal_byte_exact(self):
        """Given the print_loop fixture compiled against tracer.h /
        When run + parsed / Then last STATE stdout == terminal stdout,
        byte-exact (cout/printf interleave order preserved)."""
        with tempfile.TemporaryDirectory() as tmp:
            terminal_stdout, trace_raw = _run_gcc_local(
                _instrumented_source(), Path(tmp)
            )
        assert terminal_stdout == EXPECTED_OUTPUT
        events = parse(trace_raw)
        states = [e for e in events if e.type.value == "state"]
        assert states, "expected STATE events in trace"
        assert states[-1].stdout == terminal_stdout
        assert states[-1].stdout_truncated is False

    def test_docker_runner_stdout_compat_preserved(self):
        """Given the same program via Docker sandbox / When run /
        Then container stdout still carries the full output (compat)
        and trace deltas accumulate byte-exact."""
        from app.core.executor.docker_runner import run_in_sandbox

        result = asyncio.run(run_in_sandbox(_instrumented_source()))
        assert result.compile_error is None, result.compile_error
        assert result.stdout == EXPECTED_OUTPUT
        events = parse(result.trace_raw)
        states = [e for e in events if e.type.value == "state"]
        assert states and states[-1].stdout == EXPECTED_OUTPUT
