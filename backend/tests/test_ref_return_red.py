"""test_ref_return_red.py — non-copyable return binding (P0-11).

P0-11: an unsafe return expression yielding a non-copyable reference
(`std::ostream&`, ternary or `<<`-chain — parens/call/ternary force the temp
path) is emitted as `auto __algotrace_ret_N = (expr);`, which copy-initializes
the temp and fails with g++ `use of deleted function
basic_ostream::basic_ostream(const basic_ostream&)`.

Fix (mandated): bind unsafe return temps with exactly `auto&&` (NOT
`decltype(auto)` — it mis-binds void/bitfield/prvalue shapes here) at the
FUNC_EXIT temp path and the `__trace_ret_fallback_*` path. Correctness rests
on the `__ser` generic fallback (tracer.h catch-all) serializing the bound
ref to the `"<opaque>"` placeholder. Safe-expr path and exit event shape
untouched.

Tests 1-2 MUST FAIL on pre-fix code (deleted-copy compile break); the rest
lock the controls (placeholder `r`, value-return `r` unchanged, fallback
spelling).
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

from app.core.instrumenter.injector import instrument

TRACER_H = Path(__file__).parent.parent / "app" / "core" / "instrumenter" / "tracer.h"
INJECTOR = Path(__file__).parent.parent / "app" / "core" / "instrumenter" / "injector.py"

# P0-11 shape: ternary picks one of two non-copyable streams — `?:` forces
# the temp path (safe-expr rejects parens/ternary/comma/calls).
OSTREAM_SRC = (
    "#include <iostream>\n"
    "std::ostream& pick(bool b) {\n"
    "    return b ? std::cout : std::cerr;\n"
    "}\n"
    "int main() { pick(true) << \"hi\" << std::endl; return 0; }\n"
)

# P0-11 member shape: `<<`-chain yields `std::ostream&`; parens force temp path.
OSTREAM_MEMBER_SRC = (
    "#include <iostream>\n"
    "struct L {\n"
    "    std::ostream& out;\n"
    "    std::ostream& w(int v) {\n"
    "        return (out << v);\n"
    "    }\n"
    "};\n"
    "int main() { L l{std::cout}; l.w(7) << std::endl; return 0; }\n"
)

# Control: plain unsafe value-return — compiles before and after, `r` unchanged.
VALUE_SRC = (
    "#include <iostream>\n"
    "int g(int x) { return x * 2; }\n"
    "int f(int v) {\n"
    "    return g(v) + 1;\n"
    "}\n"
    "int main() { std::cout << f(3) << std::endl; return 0; }\n"
)


def _compile_and_run(source: str) -> tuple[int, str, str, list[dict]]:
    """Compile instrumented source, run it; return (code, stderr, stdout, events)."""
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        src = tmp_path / "prog.cpp"
        src.write_text(source)
        shutil.copy(TRACER_H, tmp_path / "tracer.h")
        binary = tmp_path / "prog"
        compiled = subprocess.run(
            ["g++", "-O0", "-std=c++17", "-I", str(tmp_path),
             "-o", str(binary), str(src)],
            capture_output=True, text=True, check=False,
        )
        if compiled.returncode != 0:
            return compiled.returncode, compiled.stderr, "", []
        ran = subprocess.run(
            [str(binary)], capture_output=True, text=True, check=False, timeout=60,
        )
        events = []
        for line in ran.stderr.splitlines():
            if line.startswith("TRACE:"):
                try:
                    events.append(json.loads(line[len("TRACE:"):]))
                except json.JSONDecodeError:
                    pass
        return 0, "", ran.stdout.strip(), events


def _exit_values(events: list[dict], func: str) -> list:
    return [e["r"] for e in events if e.get("t") == "exit" and e.get("f") == func]


def _instrument(src_text: str, name: str, tmp_path: Path) -> str:
    src = tmp_path / name
    src.write_text(src_text)
    return instrument(src_text, str(src))


class TestRefReturn:
    def test_ostream_ternary_return_compiles_and_runs(
        self, tmp_path: Path,
    ) -> None:
        """RED driver P0-11: ostream& ternary return must compile+run."""
        out = _instrument(OSTREAM_SRC, "pick.cpp", tmp_path)
        code, stderr, stdout, events = _compile_and_run(out)
        assert code == 0, f"non-copyable return broke:\n{stderr}"
        assert stdout == "hi", f"wrong stdout: {stdout!r}"
        # __ser catch-all serializes the bound ref to the placeholder
        # (tracer.h:541 emits `"<opaque>"`; JSON-parsed value is `<opaque>`).
        assert _exit_values(events, "pick") == ['<opaque>']

    def test_ostream_chain_return_compiles_and_runs(
        self, tmp_path: Path,
    ) -> None:
        """RED driver P0-11 member shape: `return (out << v)` must compile+run."""
        out = _instrument(OSTREAM_MEMBER_SRC, "member.cpp", tmp_path)
        code, stderr, stdout, events = _compile_and_run(out)
        assert code == 0, f"non-copyable return broke:\n{stderr}"
        assert stdout == "7", f"wrong stdout: {stdout!r}"
        assert _exit_values(events, "w") == ['<opaque>']

    def test_value_return_unchanged(self, tmp_path: Path) -> None:
        """Control: value-return `r` values are unchanged by the rebinding."""
        out = _instrument(VALUE_SRC, "value.cpp", tmp_path)
        code, stderr, stdout, events = _compile_and_run(out)
        assert code == 0, f"value return broke:\n{stderr}"
        assert stdout == "7", f"wrong stdout: {stdout!r}"
        assert _exit_values(events, "f") == [7]

    def test_main_temp_binds_forwarding_ref(self, tmp_path: Path) -> None:
        """Spelling lock: FUNC_EXIT temp binds with exactly `auto&&`."""
        out = _instrument(OSTREAM_SRC, "spell.cpp", tmp_path)
        assert re.search(r"\{ auto&& __algotrace_ret_\d+ =", out), (
            "main temp path must bind with auto&&"
        )
        assert re.search(r"\{ auto [A-Za-z_]", out) is None, (
            "plain-auto temp binding must be gone"
        )

    def test_fallback_temp_binds_forwarding_ref(self) -> None:
        """Spelling lock: fallback path binds with exactly `auto&&`.

        The fallback is a legacy safety net unreachable via natural programs
        on the current walker (ENTER-without-EXIT never occurs), so this
        locks the emission spelling directly — RED on `auto`, GREEN on
        `auto&&`.
        """
        text = INJECTOR.read_text()
        fb_idx = text.index("__algotrace_ret_fallback_{fn}")
        region = text[fb_idx:fb_idx + 800]
        assert "auto&& {ret_var}" in region, (
            "fallback temp must bind with auto&&"
        )
        assert re.search(r"\{ auto \{ret_var\}", region) is None, (
            "plain-auto fallback binding must be gone"
        )
