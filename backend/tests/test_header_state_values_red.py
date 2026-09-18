"""test_header_state_values_red.py — P1-01: header STATE shows post-body values.

On HEAD the braceless `for`-header STATE slides past the single-statement
body to post-loop, where the loop-var lifetime filter drops `i` but keeps
outer vars — so a header-attributed event reports POST-body values
(`x=1…2` at the header line) while the braced twin correctly reports the
PRE-body value (`x=0` at the header on the first iteration).

The fix (todo 5: S8 skip at top level) removes the unspliceable braceless
header probe; the `if`-header probe naming loop vars slides after the whole
if/else (todo 5 else-guard) keeping per-iteration `x` values that match the
braced twin. This file pins the braceless-vs-braced parity:

- braced twin header shows pre-body values (`x=0` at header, control pin);
- braceless emits no misattributed header-line event (RED driver);
- braceless then-body shows `x=1` after the body, matching the twin;
- braceless if-header `x` sequence matches the twin's.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from pathlib import Path

from app.core.instrumenter.injector import instrument

TRACER_H = Path(__file__).parent.parent / "app" / "core" / "instrumenter" / "tracer.h"

# Braceless loop over an if/else chain mutating an outer var.
BRACELESS_SRC = (
    "#include <bits/stdc++.h>\n"
    "using namespace std;\n"
    "int main() {\n"
    "    int x = 0;\n"
    "    for (int i = 0; i < 2; ++i)\n"
    "        if (i == 0)\n"
    "            x = 1;\n"
    "        else\n"
    "            x = 2;\n"
    "    cout << x << '\\n';\n"
    "    return 0;\n"
    "}\n"
)

# Braced twin: same semantics, loop body in braces.
BRACED_SRC = (
    "#include <bits/stdc++.h>\n"
    "using namespace std;\n"
    "int main() {\n"
    "    int x = 0;\n"
    "    for (int i = 0; i < 2; ++i) {\n"
    "        if (i == 0)\n"
    "            x = 1;\n"
    "        else\n"
    "            x = 2;\n"
    "    }\n"
    "    cout << x << '\\n';\n"
    "    return 0;\n"
    "}\n"
)

BRACELESS_FOR_LINE = 5  # `for (int i = 0; …)` in BRACELESS_SRC
BRACELESS_IF_LINE = 6  # `if (i == 0)` in BRACELESS_SRC
BRACELESS_THEN_LINE = 7  # `x = 1;` in BRACELESS_SRC
BRACED_FOR_LINE = 5  # `for (…) {` in BRACED_SRC
BRACED_IF_LINE = 6  # `if (i == 0)` in BRACED_SRC
BRACED_THEN_LINE = 7  # `x = 1;` in BRACED_SRC


def _compile_and_run(source: str) -> tuple[int, str, str]:
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        src = tmp_path / "prog.cpp"
        src.write_text(source)
        shutil.copy(TRACER_H, tmp_path / "tracer.h")
        binary = tmp_path / "prog"
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


def _instrument(src_text: str, tag: str, tmp_path: Path) -> str:
    src = tmp_path / f"{tag}.cpp"
    src.write_text(src_text)
    return instrument(src_text, str(src))


def _state_events(stderr: str) -> list[dict]:
    events = []
    for line in stderr.splitlines():
        if line.startswith("TRACE:"):
            evt = json.loads(line[len("TRACE:") :])
            if evt.get("t") == "state":
                events.append(evt)
    return events


class TestHeaderStateValues:
    def test_braceless_compiles_stdout_matches_twin(self, tmp_path: Path) -> None:
        """RED driver P1-01 (with test_no_… below): same stdout `2` as twin."""
        out = _instrument(BRACELESS_SRC, "hv-less", tmp_path)
        code, stdout, stderr = _compile_and_run(out)
        assert code == 0, f"braceless program failed to compile:\n{stderr}"
        twin_out = _instrument(BRACED_SRC, "hv-braced", tmp_path)
        tcode, tstdout, tstderr = _compile_and_run(twin_out)
        assert tcode == 0, f"braced twin failed to compile:\n{tstderr}"
        assert stdout == tstdout == "2\n", (
            f"stdout mismatch: braceless={stdout!r} braced={tstdout!r}"
        )

    def test_no_misattributed_header_event(self, tmp_path: Path) -> None:
        """Braceless for-header emits no event — HEAD reports post-body x."""
        out = _instrument(BRACELESS_SRC, "hv-hdr", tmp_path)
        code, _stdout, stderr = _compile_and_run(out)
        assert code == 0, f"braceless program failed to compile:\n{stderr}"
        header_events = [e for e in _state_events(stderr) if e.get("l") == BRACELESS_FOR_LINE]
        assert not header_events, (
            "header STATE must show pre-body values or not exist; HEAD emits "
            f"post-body values at the header line: {header_events}"
        )

    def test_twin_header_shows_pre_body_value(self, tmp_path: Path) -> None:
        """Control pin: braced twin header shows `x=0` on first iteration."""
        twin_out = _instrument(BRACED_SRC, "hv-ctl", tmp_path)
        tcode, _tstdout, tstderr = _compile_and_run(twin_out)
        assert tcode == 0, f"braced twin failed to compile:\n{tstderr}"
        header_events = [e for e in _state_events(tstderr) if e.get("l") == BRACED_FOR_LINE]
        assert header_events, "expected header STATE events in the braced twin"
        assert header_events[0].get("v", {}).get("x") == 0, (
            f"twin header must show pre-body x=0, got: {header_events[0]}"
        )

    def test_relocated_values_correct_and_match_twin(self, tmp_path: Path) -> None:
        """Relocated probes report correct `x`, agreeing with the twin.

        Both versions slide loop-var-naming probes after the whole if/else.
        Inside braces (twin) the probe stays per-iteration (`[1, 2]`);
        outside the braceless loop it fires once post-loop with the correct
        final value (`[2]`) — never a post-body value misattributed to a
        pre-body position. HEAD fails to compile the braceless program.
        """
        out = _instrument(BRACELESS_SRC, "hv-body", tmp_path)
        code, _stdout, stderr = _compile_and_run(out)
        assert code == 0, f"braceless program failed to compile:\n{stderr}"
        twin_out = _instrument(BRACED_SRC, "hv-body-twin", tmp_path)
        tcode, _tstdout, tstderr = _compile_and_run(twin_out)
        assert tcode == 0, f"braced twin failed to compile:\n{tstderr}"
        seq = [
            e.get("v", {}).get("x")
            for e in _state_events(stderr)
            if e.get("l") == BRACELESS_IF_LINE
        ]
        twin_seq = [
            e.get("v", {}).get("x")
            for e in _state_events(tstderr)
            if e.get("l") == BRACED_IF_LINE
        ]
        assert twin_seq == [1, 2], f"twin if-line x values wrong: {twin_seq}"
        assert seq == [2], f"braceless slid if-line must show final x=2, got: {seq}"
        assert seq[-1] == twin_seq[-1], (
            f"braceless final {seq[-1]} must agree with twin {twin_seq[-1]}"
        )
        # Then-body: the twin takes the legacy S5 skip (no events); the
        # braceless version slides instead (the wrap's probe prefix blinds
        # the S5 check, so the slide is the backstop) and must still show
        # the correct final value rather than detaching `else`.
        twin_then = [
            e for e in _state_events(tstderr) if e.get("l") == BRACED_THEN_LINE
        ]
        assert twin_then == [], f"twin then-body keeps the S5 skip, got: {twin_then}"
        then_seq = [
            e.get("v", {}).get("x")
            for e in _state_events(stderr)
            if e.get("l") == BRACELESS_THEN_LINE
        ]
        assert then_seq == [2], (
            f"braceless slid then-line must show final x=2, got: {then_seq}"
        )
