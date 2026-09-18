"""test_branch_json_red.py — branch-`c` JSON escaping (P1-10).

P1-10: tracer.h `__TRACE_BRANCH`/`__TRACE_BRANCH_OPS` emit `"c":"%s"`
with the raw condition text. Any `"` or `\\` in the condition (string
literals, macro-built conds) breaks the JSON envelope at runtime:
`json.loads` fails (task-21: col 49/49/61, g++ exit 0).

Fix: route the branch `c` field through `__trace_json_escape`
(tracer-side), keeping the spliced C++ literal valid. `tk`/`op`
unchanged; plain conds byte-identical.

Wave-0 verdict P1-10 BROKEN → this fix is required.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from pathlib import Path

from app.core.instrumenter.injector import instrument

TRACER_H = Path(__file__).parent.parent / "app" / "core" / "instrumenter" / "tracer.h"

QUOTE_SRC = (
    "#include <iostream>\n"
    "#include <string>\n"
    "int main() {\n"
    '    std::string s = "a\\"b";\n'
    '    if (s == "a\\"b") { std::cout << "TAKEN_Q" << std::endl; }\n'
    "    return 0;\n"
    "}\n"
)

BACKSLASH_SRC = (
    "#include <iostream>\n"
    "#include <string>\n"
    "int main() {\n"
    '    std::string s = "a\\\\b";\n'
    '    if (s == "a\\\\b") { std::cout << "TAKEN_B" << std::endl; }\n'
    "    return 0;\n"
    "}\n"
)

MACRO_SRC = (
    "#include <iostream>\n"
    "#include <string>\n"
    "#define IS_OK(x) ((x) > 0 && (x) < 100)\n"
    "int main() {\n"
    "    int v = 42;\n"
    '    std::string s = "q";\n'
    '    if (IS_OK(v) && s == "q") { std::cout << "TAKEN_M" << std::endl; }\n'
    "    return 0;\n"
    "}\n"
)

PLAIN_SRC = (
    "#include <iostream>\n"
    "int main() {\n"
    "    int x = 5;\n"
    "    if (x > 0) { std::cout << \"TAKEN_C\" << std::endl; }\n"
    "    return 0;\n"
    "}\n"
)


def _trace_payloads(source: str) -> tuple[list[str], str]:
    """Instrument, compile, run; return (raw TRACE payloads, stdout)."""
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        (tmp_path / "prog.cpp").write_text(instrument(source, None))
        shutil.copy(TRACER_H, tmp_path / "tracer.h")
        binary = tmp_path / "prog"
        compiled = subprocess.run(
            ["g++", "-O0", "-std=c++17", "-I", str(tmp_path),
             "-o", str(binary), str(tmp_path / "prog.cpp")],
            capture_output=True, text=True, check=False,
        )
        assert compiled.returncode == 0, f"g++ failed: {compiled.stderr}"
        ran = subprocess.run(
            [str(binary)], capture_output=True, text=True, check=False, timeout=60,
        )
        assert ran.returncode == 0, f"program failed: {ran.stderr}"
        payloads = [
            line[len("TRACE:"):]
            for line in ran.stderr.splitlines()
            if line.startswith("TRACE:")
        ]
        assert payloads, "no TRACE lines emitted"
        return payloads, ran.stdout


def _parse_all_strict(payloads: list[str]) -> list[dict]:
    """json.loads every TRACE line — any failure raises (RED on broken)."""
    return [json.loads(p) for p in payloads]


def test_branch_quote_cond_parses():
    payloads, _ = _trace_payloads(QUOTE_SRC)
    events = _parse_all_strict(payloads)
    branch = [e for e in events if e.get("t") == "branch"]
    assert branch and branch[0]["tk"] is True


def test_branch_backslash_cond_parses():
    payloads, _ = _trace_payloads(BACKSLASH_SRC)
    events = _parse_all_strict(payloads)
    branch = [e for e in events if e.get("t") == "branch"]
    assert branch and branch[0]["tk"] is True


def test_branch_macro_cond_parses():
    payloads, _ = _trace_payloads(MACRO_SRC)
    events = _parse_all_strict(payloads)
    branch = [e for e in events if e.get("t") == "branch"]
    assert branch and branch[0]["tk"] is True


def test_branch_plain_cond_unchanged():
    payloads, _ = _trace_payloads(PLAIN_SRC)
    events = _parse_all_strict(payloads)
    branch = [e for e in events if e.get("t") == "branch"]
    assert branch and branch[0]["c"] == "x > 0"
    assert branch[0]["tk"] is True
    assert "op" in branch[0]
