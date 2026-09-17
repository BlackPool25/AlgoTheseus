"""
test_loop_header_leak_red.py — RED repro for Scenario S1 loop-header STATE leak.

Root cause (confirmed, NOT fixed here): injector `_state_insert_line`
advances a header-anchored STATE past a braceless loop body to post-loop,
where the range-for variable is dead; `_trace_state` unions the post set
with no lifetime check. Repro shows e.g. `__TRACE_STATE(6,...,"x",x)`
emitted after `cin>>x;` and g++ rejects it with
`'x' was not declared in this scope`.

These tests assert the FIXED behavior, so they MUST FAIL on current code.
"""

import shutil
import subprocess
import tempfile
from pathlib import Path

from app.core.instrumenter.ast_walker import InjectKind, walk
from app.core.instrumenter.injector import instrument
from app.core.instrumenter.scope_tracker import build_scope_map

TRACER_H = Path(__file__).parent.parent / "app" / "core" / "instrumenter" / "tracer.h"

# S1 fixture: braceless range-for over `int &x`, body `cin >> x;`,
# then a shadowing `int x;` so post-loop placement binds nothing (pre-shadow).
S1_SRC = (
    "#include <vector>\n"
    "#include <iostream>\n"
    "using namespace std;\n"
    "int main() {\n"
    "    vector<int> a = {1, 2, 3};\n"
    "    for (int &x : a)\n"
    "        cin >> x;\n"
    "    int x = 5;\n"
    "    cout << x << endl;\n"
    "    return 0;\n"
    "}\n"
)

HEADER_LINE = 6  # `for (int &x : a)` header line in S1_SRC
BODY_SUBSTR = "cin >> x;"  # braceless loop body line


def _compile(source: str) -> tuple[int, str]:
    """Mirror backend/tests/test_injector.py::_compile_and_run (compile half).

    Returns (returncode, stderr). Copies tracer.h into the temp dir and
    compiles with the same flags: g++ -O0 -std=c++17.
    """
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        src = tmp_path / "prog.cpp"
        src.write_text(source)
        shutil.copy(TRACER_H, tmp_path / "tracer.h")
        binary = tmp_path / "prog"
        result = subprocess.run(
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
        return result.returncode, result.stderr


def _offending_post_body_lines(instrumented: str) -> list[str]:
    """__TRACE_STATE lines referencing `"x", x` placed after the loop body."""
    lines = instrumented.splitlines()
    try:
        body_idx = next(i for i, l in enumerate(lines) if BODY_SUBSTR in l)
    except StopIteration:
        return [f"<{BODY_SUBSTR!r} body line missing from instrumented source>"]
    shadow_idx = next((i for i, l in enumerate(lines) if "int x = 5;" in l), len(lines))
    return [
        f"instr-line {i + 1}: {l.strip()}"
        for i, l in enumerate(lines)
        if i > body_idx and i < shadow_idx and "__TRACE_STATE" in l and '"x", x' in l
    ]


class TestS1LoopHeaderStateLeak:
    def test_no_post_loop_state_referencing_dead_header_var(self, tmp_path):
        src = tmp_path / "s1.cpp"
        src.write_text(S1_SRC)
        instrumented = instrument(S1_SRC, str(src))

        offending = _offending_post_body_lines(instrumented)
        print("\nOFFENDING post-loop __TRACE_STATE lines:")
        for line in offending:
            print("  " + line)
        assert not offending, (
            "S1 LEAK: header-anchored STATE referencing dead loop var `x` "
            "placed after loop body:\n" + "\n".join(offending)
        )

        code, stderr = _compile(instrumented)
        assert code == 0, (
            "S1 LEAK: instrumented source does not compile "
            "(expect `'x' was not declared in this scope` pre-fix):\n" + stderr
        )

    def test_header_state_point_scoped_to_loop(self, tmp_path):
        """Scope-level: the header STATE point exists and must stay in-loop.

        walk() anchors a STATE point at the for-header line carrying the
        header var; build_scope_map() proves `x` there is the loop var.
        The injected `__TRACE_STATE(<header>,...,"x",x)` event must then be
        emitted before (or inside) the loop body — never post-loop where
        the header var is dead.
        """
        src = tmp_path / "s1scope.cpp"
        src.write_text(S1_SRC)

        result = walk(str(src))
        header_states = [
            p
            for p in result.injection_points
            if p.kind == InjectKind.STATE and p.line == HEADER_LINE
        ]
        assert header_states, (
            f"expected a header STATE point at line {HEADER_LINE}, "
            f"got STATE lines: {sorted(p.line for p in result.injection_points if p.kind == InjectKind.STATE)}"
        )

        scopes = build_scope_map(str(src))
        assert "x" in [v.name for v in scopes["main"].vars_at_line.get(HEADER_LINE, [])]
        # `_trace_state` unions point vars with vars_at_line_post[line]:
        # this is the union source that smuggles dead loop-`x` into the
        # post-loop emission.
        assert "x" in [v.name for v in scopes["main"].vars_at_line_post.get(HEADER_LINE, [])]

        instrumented = instrument(S1_SRC, str(src))
        lines = instrumented.splitlines()
        body_idx = next(i for i, l in enumerate(lines) if BODY_SUBSTR in l)
        leaked = [
            f"instr-line {i + 1}: {l.strip()}"
            for i, l in enumerate(lines)
            if f"__TRACE_STATE({HEADER_LINE}," in l and '"x", x' in l and i > body_idx
        ]
        print("\nHEADER-event TRACE lines placed after loop body:")
        for line in leaked:
            print("  " + line)
        assert not leaked, (
            f"S1 LEAK: __TRACE_STATE({HEADER_LINE},...) referencing `x` "
            f"emitted after loop body (post-loop, header var dead):\n" + "\n".join(leaked)
        )
