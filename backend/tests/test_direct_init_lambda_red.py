"""test_direct_init_lambda_red.py — P0-05/P0-06: direct-list-init + parens-less lambda.

_state_insert_line (injector.py) only deferred STATE probes for `= {`
initializers (8575a01) and parens-ful lambdas (`[](){`). Two shapes still
splice the probe mid-statement:

P0-05: `std::vector<int> v{` without `=` — header ends with `{`, treated as
  statement-complete, probe lands inside the init list → g++
  `expected primary-expression before 'do'`.
P0-06: parens-less lambda (`auto g = []{`) — the lambda regex requires
  `\\(.*\\)`, so no brace-balance scan; probe lands inside the lambda body
  → g++ `use of 'g' before deduction of 'auto'`.

Test 1 + 2 MUST FAIL on pre-fix code (file-level RED); the rest lock
placement and the `= {` control from 8575a01.
"""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

from app.core.instrumenter.injector import instrument

TRACER_H = Path(__file__).parent.parent / "app" / "core" / "instrumenter" / "tracer.h"

DIRECT_INIT_SRC = (
    "#include <bits/stdc++.h>\n"
    "using namespace std;\n"
    "int main() {\n"
    "    std::vector<int> v{\n"
    "        1, 2, 3\n"
    "    };\n"
    "    cout << v.size() << \" \" << v[0] + v[1] + v[2] << '\\n';\n"
    "    return 0;\n"
    "}\n"
)

LAMBDA_SRC = (
    "#include <bits/stdc++.h>\n"
    "using namespace std;\n"
    "int main() {\n"
    "    auto g = []{\n"
    "        return 42;\n"
    "    };\n"
    "    cout << g() << '\\n';\n"
    "    return 0;\n"
    "}\n"
)

EQ_BRACE_SRC = (
    "#include <bits/stdc++.h>\n"
    "using namespace std;\n"
    "int main() {\n"
    "    int values[] = {\n"
    "        1, 2, 3\n"
    "    };\n"
    "    cout << values[0] + values[1] + values[2] << '\\n';\n"
    "    return 0;\n"
    "}\n"
)


def _compile(source: str) -> tuple[int, str]:
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        src = tmp_path / "prog.cpp"
        src.write_text(source)
        shutil.copy(TRACER_H, tmp_path / "tracer.h")
        binary = tmp_path / "prog"
        result = subprocess.run(
            ["g++", "-O0", "-std=c++17", "-I", str(tmp_path),
             "-o", str(binary), str(src)],
            capture_output=True, text=True, check=False,
        )
        return result.returncode, result.stderr


def _compile_and_run(source: str) -> tuple[int, str, str]:
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        src = tmp_path / "prog.cpp"
        src.write_text(source)
        shutil.copy(TRACER_H, tmp_path / "tracer.h")
        binary = tmp_path / "prog"
        comp = subprocess.run(
            ["g++", "-O0", "-std=c++17", "-I", str(tmp_path),
             "-o", str(binary), str(src)],
            capture_output=True, text=True, check=False,
        )
        if comp.returncode != 0:
            return comp.returncode, "", comp.stderr
        run = subprocess.run([str(binary)], capture_output=True, text=True, check=False)
        return run.returncode, run.stdout, run.stderr


class TestDirectInitLambda:
    def test_direct_list_init_compiles(self, tmp_path: Path) -> None:
        """RED driver P0-05: probe inside `v{...}` init list must not happen."""
        src = tmp_path / "direct.cpp"
        src.write_text(DIRECT_INIT_SRC)
        out = instrument(DIRECT_INIT_SRC, str(src))
        code, stderr = _compile(out)
        assert code == 0, f"direct-list-init probe failed to compile:\n{stderr}"

    def test_parensless_lambda_compiles(self, tmp_path: Path) -> None:
        """RED driver P0-06: probe inside parens-less lambda body must not happen."""
        src = tmp_path / "lambda.cpp"
        src.write_text(LAMBDA_SRC)
        out = instrument(LAMBDA_SRC, str(src))
        code, stderr = _compile(out)
        assert code == 0, f"parens-less lambda probe failed to compile:\n{stderr}"

    def test_direct_init_probe_after_close(self, tmp_path: Path) -> None:
        """No __TRACE_STATE line may sit between `v{` header and `};`."""
        src = tmp_path / "direct2.cpp"
        src.write_text(DIRECT_INIT_SRC)
        out = instrument(DIRECT_INIT_SRC, str(src))
        lines = out.splitlines()
        opener = next(
            i for i, ln in enumerate(lines)
            if "std::vector<int> v" in ln and ln.strip().endswith("{")
        )
        closer = next(
            i for i, ln in enumerate(lines[opener + 1:], start=opener + 1)
            if ln.strip() == "};"
        )
        leaked = [
            ln for ln in lines[opener + 1 : closer]
            if ln.strip().startswith("__TRACE_STATE")
        ]
        assert not leaked, f"probe leaked inside direct-list-init: {leaked}"

    def test_lambda_probe_after_close(self, tmp_path: Path) -> None:
        """No __TRACE_STATE naming `g` may sit between `[]{` header and `};`.

        (The walker still emits its pre-existing var-less lambda-body-scope
        STATE — parens-ful lambdas do the same on HEAD — so only the DECL
        probe naming `g` is locked here.)"""
        src = tmp_path / "lambda2.cpp"
        src.write_text(LAMBDA_SRC)
        out = instrument(LAMBDA_SRC, str(src))
        lines = out.splitlines()
        opener = next(
            i for i, ln in enumerate(lines)
            if "auto g = []" in ln and ln.strip().endswith("{")
        )
        closer = next(
            i for i, ln in enumerate(lines[opener + 1:], start=opener + 1)
            if ln.strip() == "};"
        )
        leaked = [
            ln for ln in lines[opener + 1 : closer]
            if ln.strip().startswith("__TRACE_STATE") and '"g"' in ln
        ]
        assert not leaked, f"probe leaked inside lambda body: {leaked}"

    def test_direct_init_runs_correct_stdout(self, tmp_path: Path) -> None:
        """Instrumented direct-list-init binary prints `3 6`."""
        src = tmp_path / "direct3.cpp"
        src.write_text(DIRECT_INIT_SRC)
        out = instrument(DIRECT_INIT_SRC, str(src))
        code, stdout, stderr = _compile_and_run(out)
        assert code == 0, f"instrumented direct-init binary failed:\n{stderr}"
        assert "3 6" in stdout, f"wrong stdout: {stdout!r}"

    def test_lambda_runs_correct_stdout(self, tmp_path: Path) -> None:
        """Instrumented lambda binary prints `42`."""
        src = tmp_path / "lambda3.cpp"
        src.write_text(LAMBDA_SRC)
        out = instrument(LAMBDA_SRC, str(src))
        code, stdout, stderr = _compile_and_run(out)
        assert code == 0, f"instrumented lambda binary failed:\n{stderr}"
        assert "42" in stdout, f"wrong stdout: {stdout!r}"

    def test_eq_brace_control_still_after_close(self, tmp_path: Path) -> None:
        """8575a01 control: `= {` still compiles, probes after `};`, prints `6`."""
        src = tmp_path / "eqbrace.cpp"
        src.write_text(EQ_BRACE_SRC)
        out = instrument(EQ_BRACE_SRC, str(src))
        code, stdout, stderr = _compile_and_run(out)
        assert code == 0, f"= {{}} control failed to compile:\n{stderr}"
        assert "6" in stdout, f"wrong stdout: {stdout!r}"
        lines = out.splitlines()
        opener = next(
            i for i, ln in enumerate(lines)
            if "int values[]" in ln and ln.strip().endswith("{")
        )
        closer = next(
            i for i, ln in enumerate(lines[opener + 1:], start=opener + 1)
            if ln.strip() == "};"
        )
        leaked = [
            ln for ln in lines[opener + 1 : closer]
            if ln.strip().startswith("__TRACE_STATE")
        ]
        assert not leaked, f"= {{}} probe leaked: {leaked}"
