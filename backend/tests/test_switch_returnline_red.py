"""test_switch_returnline_red.py — P1-08: switch attribution + return_line.

Two parser-side line misattributions (event shapes untouched):

(a) Switch decision at the body-statement line: the injector emits the
    taken-case BRANCH probe at the first body statement with a vacuous
    condition (``c="true /* switch(x) == case 2 */"``). The header probe
    (``__TRACE_STATE`` right after ``switch (x) {``) is unreachable at
    runtime — control jumps straight to the case label (g++ even warns
    ``-Wswitch-unreachable``) — so the parser never observes the header
    line directly. It must attribute the decision back to the header::

        branch l=14 c="true /* switch(x) == case 2 */"  but  header l=9

(b) ``return_line`` as the callee brace line: ``_apply_gutter_lines``
    records the FUNC_ENTER line, but the render spec maps return lines
    back to the call site (the caller STATE line)::

        exit rl=3  but  call site rl=8

The fix (todo 16, parser.py only): remap switch-label branches to the
header line and record the caller STATE line as ``return_line``.
Plain if/else branches keep their lines (control below).
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

from app.core.instrumenter.injector import instrument
from app.core.trace.parser import parse

TRACER_H = Path(__file__).parent.parent / "app" / "core" / "instrumenter" / "tracer.h"

# Canonical layout, 1-based lines:
#   3: int helper(int a) {      <- callee enter
#   8:     int h = helper(x);   <- call-site STATE
#   9:     switch (x) {         <- switch header
#  14:         h = 20;          <- taken body statement
SWITCH_SRC = (
    "#include <bits/stdc++.h>\n"  # 1
    "using namespace std;\n"  # 2
    "int helper(int a) {\n"  # 3
    "    return a * 2;\n"  # 4
    "}\n"  # 5
    "int main() {\n"  # 6
    "    int x = 2;\n"  # 7
    "    int h = helper(x);\n"  # 8
    "    switch (x) {\n"  # 9
    "    case 1:\n"  # 10
    "        h = 10;\n"  # 11
    "        break;\n"  # 12
    "    case 2:\n"  # 13
    "        h = 20;\n"  # 14
    "        break;\n"  # 15
    "    default:\n"  # 16
    "        h = 30;\n"  # 17
    "    }\n"  # 18
    "    return 0;\n"  # 19
    "}\n"  # 20
)

HEADER_LINE = 9
BODY_LINE = 14
CALL_SITE_LINE = 8
CALLEE_ENTER_LINE = 3

# Faithful wire copy of the real trace for SWITCH_SRC (tracer emits no
# pl/rl; `d` values recomputed by parse). Only the taken case-2 branch
# fires — untaken alternatives emit nothing (enumeration untouched).
SWITCH_WIRE = [
    {"t": "enter", "l": 6, "f": "main", "d": 0, "p": {}},
    {"t": "state", "l": 7, "f": "main", "d": 0, "v": {"x": 2}},
    {"t": "enter", "l": 3, "f": "helper", "d": 1, "p": {"a": 2}},
    {"t": "state", "l": 4, "f": "helper", "d": 1, "v": {"a": 2}},
    {"t": "exit", "l": 4, "f": "helper", "d": 1, "r": 4},
    {"t": "state", "l": 8, "f": "main", "d": 0, "v": {"x": 2, "h": 4}},
    {
        "t": "branch",
        "l": 14,
        "f": "main",
        "d": 0,
        "c": "true /* switch(x) == case 2 */",
        "tk": True,
    },
    {"t": "state", "l": 14, "f": "main", "d": 0, "v": {"x": 2, "h": 20}},
    {"t": "state", "l": 19, "f": "main", "d": 0, "v": {"x": 2, "h": 20}},
    {"t": "exit", "l": 19, "f": "main", "d": 0, "r": 0},
]

# Control: plain if/else — branch lines must stay exactly where emitted.
PLAIN_WIRE = [
    {"t": "enter", "l": 1, "f": "main", "d": 0, "p": {}},
    {"t": "state", "l": 2, "f": "main", "d": 0, "v": {"x": 1}},
    {"t": "branch", "l": 3, "f": "main", "d": 0, "c": "x > 0", "tk": True},
    {"t": "state", "l": 4, "f": "main", "d": 0, "v": {"x": 2}},
    {"t": "exit", "l": 5, "f": "main", "d": 0, "r": 0},
]


def _raw(wire: list[dict]) -> list[str]:
    return [json.dumps(ev) for ev in wire]


def _compile_and_run(source: str, tmp_path: Path) -> tuple[int, str, str]:
    src = tmp_path / "switch.cpp"
    src.write_text(source)
    shutil.copy(TRACER_H, tmp_path / "tracer.h")
    binary = tmp_path / "switch"
    comp = subprocess.run(
        ["g++", "-O0", "-std=c++17", "-I", str(tmp_path), "-o", str(binary), str(src)],
        capture_output=True,
        text=True,
        check=False,
    )
    if comp.returncode != 0:
        return comp.returncode, "", comp.stderr
    run = subprocess.run([str(binary)], capture_output=True, text=True, check=False)
    return run.returncode, run.stdout, run.stderr


def _trace_lines(stderr: str) -> list[str]:
    return [line[len("TRACE:") :] for line in stderr.splitlines() if line.startswith("TRACE:")]


class TestSwitchHeaderAttribution:
    def test_switch_branch_at_header_line(self) -> None:
        """Switch decision belongs to the header, not the body statement."""
        events = parse(_raw(SWITCH_WIRE))
        branches = [e for e in events if e.type.value == "branch"]
        assert len(branches) == 1
        assert branches[0].condition == "true /* switch(x) == case 2 */"
        assert branches[0].line == HEADER_LINE, (
            f"HEAD puts the decision at the body line: l={branches[0].line} "
            f'c="{branches[0].condition}" (expected header l={HEADER_LINE})'
        )

    def test_switch_branch_shape_unchanged(self) -> None:
        """Only the line moves: condition, taken flag, func stay identical."""
        events = parse(_raw(SWITCH_WIRE))
        (branch,) = [e for e in events if e.type.value == "branch"]
        assert branch.condition == "true /* switch(x) == case 2 */"
        assert branch.taken is True
        assert branch.func == "main"


class TestCallSiteReturnLine:
    def test_nested_exit_maps_to_call_site(self) -> None:
        """Gutter arrow lands on the caller STATE, not the callee brace."""
        events = parse(_raw(SWITCH_WIRE))
        helper_exits = [e for e in events if e.type.value == "exit" and e.func == "helper"]
        assert len(helper_exits) == 1
        assert helper_exits[0].return_line == CALL_SITE_LINE, (
            f"HEAD maps to the callee brace: rl={helper_exits[0].return_line} "
            f"(expected call-site rl={CALL_SITE_LINE})"
        )

    def test_outermost_exit_keeps_no_return_line(self) -> None:
        """main has no caller: return_line stays None (single highlight)."""
        events = parse(_raw(SWITCH_WIRE))
        main_exits = [e for e in events if e.type.value == "exit" and e.func == "main"]
        assert len(main_exits) == 1
        assert main_exits[0].return_line is None


class TestPlainBranchControl:
    def test_plain_if_else_lines_unchanged(self) -> None:
        """Failure control: non-switch branches keep their emitted lines."""
        events = parse(_raw(PLAIN_WIRE))
        (branch,) = [e for e in events if e.type.value == "branch"]
        assert branch.line == 3
        assert branch.condition == "x > 0"


class TestSwitchEndToEnd:
    def test_live_switch_header_and_call_site(self, tmp_path: Path) -> None:
        """Attribution oracle: real instrumented run lands on header + call site."""
        src = tmp_path / "switch.cpp"
        src.write_text(SWITCH_SRC)
        out = instrument(SWITCH_SRC, str(src))
        code, _stdout, stderr = _compile_and_run(out, tmp_path)
        assert code == 0, f"switch program failed to run:\n{stderr}"
        raw = _trace_lines(stderr)
        assert raw, "no TRACE lines captured"
        header = next(i + 1 for i, ln in enumerate(SWITCH_SRC.splitlines()) if "switch (x)" in ln)
        call_site = next(i + 1 for i, ln in enumerate(SWITCH_SRC.splitlines()) if "helper(x)" in ln)
        assert header == HEADER_LINE and call_site == CALL_SITE_LINE
        events = parse(raw)
        switch_branches = [
            e for e in events if e.type.value == "branch" and "switch(" in (e.condition or "")
        ]
        assert len(switch_branches) == 1, (
            f"expected one taken-case branch: {[e.condition for e in events if e.type.value == 'branch']}"
        )
        assert switch_branches[0].line == header, (
            f"live decision misattributed: l={switch_branches[0].line} "
            f'c="{switch_branches[0].condition}" (header l={header})'
        )
        helper_exits = [e for e in events if e.type.value == "exit" and e.func == "helper"]
        assert len(helper_exits) == 1
        assert helper_exits[0].return_line == call_site, (
            f"live return misattributed: rl={helper_exits[0].return_line} "
            f"(call-site rl={call_site})"
        )
