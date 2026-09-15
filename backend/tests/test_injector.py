"""
test_injector.py — Tests for injector.py.

Verifies that the injector produces valid C++ that compiles and runs,
and that the trace output matches expected event types.
"""

import subprocess
import tempfile
from pathlib import Path

from app.core.instrumenter.injector import instrument

FIXTURES = Path(__file__).parent / "fixtures"
TRACER_H = Path(__file__).parent.parent / "app" / "core" / "instrumenter" / "tracer.h"


def _compile_and_run(source: str, stdin: str = "") -> tuple[str, str, int]:
    """Compile instrumented source and run it. Returns (stdout, stderr, exit_code)."""
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        src = tmp_path / "prog.cpp"
        src.write_text(source)

        # Copy tracer.h into the temp dir
        import shutil
        shutil.copy(TRACER_H, tmp_path / "tracer.h")

        binary = tmp_path / "prog"
        compile_result = subprocess.run(
            ["g++", "-O0", "-std=c++17", "-I", str(tmp_path), "-o", str(binary), str(src)],
            capture_output=True, text=True, check=False,
        )
        if compile_result.returncode != 0:
            return "", compile_result.stderr, compile_result.returncode

        run_result = subprocess.run(
            [str(binary)],
            input=stdin, capture_output=True, text=True, timeout=5, check=False,
        )
        return run_result.stdout, run_result.stderr, run_result.returncode


class TestInjector:
    def test_instrumented_source_compiles(self):
        """Instrumenting simple_bsearch.cpp should produce compilable C++."""
        source = (FIXTURES / "simple_bsearch.cpp").read_text()
        instrumented = instrument(source, str(FIXTURES / "simple_bsearch.cpp"))
        _stdout, stderr, code = _compile_and_run(instrumented)
        # Compile errors show up as non-zero exit with no TRACE: lines
        trace_lines = [l for l in stderr.splitlines() if l.startswith("TRACE:")]
        assert code == 0 or len(trace_lines) > 0, f"Compile/run failed:\n{stderr}"

    def test_instrumented_source_produces_trace_output(self):
        """Running the instrumented binary should produce TRACE: lines on stderr."""
        source = (FIXTURES / "simple_bsearch.cpp").read_text()
        instrumented = instrument(source, str(FIXTURES / "simple_bsearch.cpp"))
        _stdout, stderr, _code = _compile_and_run(instrumented)
        trace_lines = [l for l in stderr.splitlines() if l.startswith("TRACE:")]
        assert len(trace_lines) > 0, "No TRACE: lines produced"

    def test_trace_contains_enter_event(self):
        """Should see at least one 'enter' event for bsearch."""
        source = (FIXTURES / "simple_bsearch.cpp").read_text()
        instrumented = instrument(source, str(FIXTURES / "simple_bsearch.cpp"))
        _, stderr, _ = _compile_and_run(instrumented)
        assert '"t":"enter"' in stderr or '"t": "enter"' in stderr

    def test_trace_contains_iter_event(self):
        """Should see at least one 'iter' event from the while loop."""
        source = (FIXTURES / "simple_bsearch.cpp").read_text()
        instrumented = instrument(source, str(FIXTURES / "simple_bsearch.cpp"))
        _, stderr, _ = _compile_and_run(instrumented)
        assert '"t":"iter"' in stderr or '"t": "iter"' in stderr

    def test_original_stdout_preserved(self):
        """The program's own stdout should not be contaminated with TRACE: data."""
        source = (FIXTURES / "simple_bsearch.cpp").read_text()
        instrumented = instrument(source, str(FIXTURES / "simple_bsearch.cpp"))
        stdout, _stderr, _ = _compile_and_run(instrumented)
        # stdout should only contain the program's output (a number)
        assert "TRACE:" not in stdout

    def test_instrument_is_idempotent_on_include(self):
        """Instrumenting should add exactly one #include 'tracer.h'."""
        source = (FIXTURES / "simple_bsearch.cpp").read_text()
        instrumented = instrument(source, str(FIXTURES / "simple_bsearch.cpp"))
        count = instrumented.count('#include "tracer.h"')
        assert count == 1

    def test_nested_multiline_if_condition_compiles_and_traces(self):
        """STATE after a multi-line if header must follow the full condition.

        Regression: STATE spliced after the header's first line splits the
        condition (if (a && / __TRACE_STATE(..); / b)) and g++ rejects it.
        """
        source = (
            "#include <vector>\n"
            "#include <string>\n"
            "using namespace std;\n"
            "int main() {\n"
            '    string s = "ababa";\n'
            "    int n = s.size();\n"
            "    vector<vector<bool>> pal(n, vector<bool>(n, false));\n"
            "    for (int i = n - 1; i >= 0; --i) {\n"
            "        for (int j = i; j < n; ++j) {\n"
            "            if (s[i] == s[j] &&\n"
            "                (j - i <= 2 || pal[i + 1][j - 1])) {\n"
            "                pal[i][j] = true;\n"
            "            }\n"
            "        }\n"
            "    }\n"
            "    return 0;\n"
            "}\n"
        )
        instrumented = instrument(source, None)
        assert ")) {\n__TRACE_STATE(10" in instrumented
        _, stderr, code = _compile_and_run(instrumented)
        assert code == 0, f"instrumented multi-line if failed to compile:\n{stderr}"
        trace_lines = [l for l in stderr.splitlines() if l.startswith("TRACE:")]
        assert len(trace_lines) > 0, "No TRACE: lines produced"
