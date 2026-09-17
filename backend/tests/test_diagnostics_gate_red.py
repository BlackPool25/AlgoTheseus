"""test_diagnostics_gate_red.py — Wave 2a diagnostics gate (TDD RED).

Gate: instrument() must raise typed InstrumentParseError on a broken
translation unit (hard syntax error), and must NOT raise on valid source.
"""

from __future__ import annotations

import re

BROKEN_SRC = "int main( {\n"
VALID_SRC = "int main() {\n    int x = 1;\n    return x;\n}\n"


class TestDiagnosticsGate:
    def test_broken_tu_raises_with_file_line(self, tmp_path):
        from app.core.instrumenter import InstrumentParseError
        from app.core.instrumenter.injector import instrument

        src = tmp_path / "broken.cpp"
        src.write_text(BROKEN_SRC)
        with __import__("pytest").raises(InstrumentParseError) as excinfo:
            instrument(BROKEN_SRC, str(src))
        assert re.search(
            r":\d+", str(excinfo.value)
        ), f"error message must carry file:line, got: {excinfo.value}"

    def test_valid_fixture_instruments_no_raise(self, tmp_path):
        from app.core.instrumenter.injector import instrument

        src = tmp_path / "valid.cpp"
        src.write_text(VALID_SRC)
        out = instrument(VALID_SRC, str(src))
        assert "__TRACE_FUNC_ENTER" in out
