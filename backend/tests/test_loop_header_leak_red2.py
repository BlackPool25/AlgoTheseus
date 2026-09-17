"""RED repro for Scenario S2: by-value braceless loop leak.

Same root cause as S1 but proves the leak is not &-specific.
(1) `for (int v : a) cout<<v;` must not emit post-loop `"v", v` TRACE;
    instrumented code must compile (g++ `'v' was not declared` = RED).
(2) `vector<int>` + `auto it = find(...)` STL/auto baseline: asserts `auto`
    spelling is captured and sort/reverse/find/erase/push_back/pop_back
    instrument + compile. Expected to pass pre-fix; records baseline.
Do NOT fix source here — these tests document RED state.
"""

import shutil
import subprocess
import tempfile
from pathlib import Path

from app.core.instrumenter.injector import instrument

TRACER_H = Path(__file__).parent.parent / "app" / "core" / "instrumenter" / "tracer.h"


def _compile_and_run(source: str, stdin: str = "") -> tuple[str, str, int]:
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        src = tmp_path / "prog.cpp"
        src.write_text(source)
        shutil.copy(TRACER_H, tmp_path / "tracer.h")
        binary = tmp_path / "prog"
        cr = subprocess.run(
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
        if cr.returncode != 0:
            return "", cr.stderr, cr.returncode
        rr = subprocess.run(
            [str(binary)],
            input=stdin,
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        return rr.stdout, rr.stderr, rr.returncode


BY_VALUE_BRACELESS = (
    "#include <bits/stdc++.h>\n"
    "using namespace std;\n"
    "int main() {\n"
    "    vector<int> a = {1, 2, 3};\n"
    "    for (int v : a) cout<<v;\n"
    '    cout << "done";\n'
    "    return 0;\n"
    "}\n"
)

STL_AUTO = (
    "#include <bits/stdc++.h>\n"
    "using namespace std;\n"
    "int main() {\n"
    "    vector<int> a = {3, 1, 2};\n"
    "    sort(a.begin(), a.end());\n"
    "    reverse(a.begin(), a.end());\n"
    "    auto it = find(a.begin(), a.end(), 2);\n"
    "    if (it != a.end()) a.erase(it);\n"
    "    a.push_back(9);\n"
    "    a.pop_back();\n"
    "    for (int x : a) cout << x;\n"
    "    return 0;\n"
    "}\n"
)


class TestByValueBracelessLeakRed:
    def test_no_post_loop_v_trace_and_compiles(self):
        """By-value braceless loop must not leak `v` past the loop body."""
        instrumented = instrument(BY_VALUE_BRACELESS, None)
        print("\n--- INSTRUMENTED (S2 case 1) ---\n" + instrumented + "\n--- END INSTRUMENTED ---")
        # Find the loop line; any `"v", v` TRACE after it (outside body) is the leak.
        lines = instrumented.splitlines()
        loop_idx = next(i for i, l in enumerate(lines) if "for" in l and "int v" in l and ":" in l)
        post = "\n".join(lines[loop_idx + 1 :])
        # Allow the in-body TRACE on the loop line(s) itself; flag post-loop refs.
        # Heuristic: a STATE/TRACE line after the single-statement body
        # referencing `"v", v` means the leak exists.
        leak_refs = [l for l in post.splitlines() if '"v", v' in l or '"v",v' in l]
        print("\n--- POST-LOOP v REFS ---\n" + "\n".join(leak_refs) + "\n--- END REFS ---")
        assert not leak_refs, "RED: by-value braceless loop leaked `v` post-loop:\n" + "\n".join(
            leak_refs
        )
        _, stderr, code = _compile_and_run(instrumented)
        trace_lines = [l for l in stderr.splitlines() if l.startswith("TRACE:")]
        print("\n--- TRACE LINES ---\n" + "\n".join(trace_lines) + "\n--- END TRACE ---")
        assert code == 0, (
            "RED: instrumented by-value braceless loop failed to compile "
            "(expect `'v' was not declared` pre-fix):\n" + stderr
        )


class TestStlAutoBaseline:
    def test_auto_spelling_captured_and_stl_compiles(self):
        """Baseline: `auto it = find(...)` spelling + STL calls survive."""
        instrumented = instrument(STL_AUTO, None)
        print("\n--- INSTRUMENTED (S2 case 2) ---\n" + instrumented + "\n--- END INSTRUMENTED ---")
        assert "auto" in instrumented, "auto spelling lost during instrumentation"
        _, stderr, code = _compile_and_run(instrumented)
        trace_lines = [l for l in stderr.splitlines() if l.startswith("TRACE:")]
        print("\n--- TRACE LINES ---\n" + "\n".join(trace_lines) + "\n--- END TRACE ---")
        assert code == 0, "STL/auto instrumented code failed to compile:\n" + stderr
        assert len(trace_lines) > 0, "No TRACE: lines produced for STL/auto case"
