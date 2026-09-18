"""test_braced_init_state_red.py — Bug-D: STATE probe inside braced initializer.

A multi-line braced-initializer DECL (`int values[] = { ... };`) ends its
header line with `{`, which _state_insert_line treated as statement-complete.
The STATE probe was spliced after the header — inside the initializer list —
so g++ rejects it (`expected primary-expression before 'do'` via
tracer.h __TRACE_STATE). The injector must defer placement to the closing
`};`, mirroring the lambda-initializer brace-balance scan.

Test 1 MUST FAIL on pre-fix code (file-level RED); the rest lock placement
and runtime trace behaviour.
"""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

from app.core.instrumenter.injector import instrument

TRACER_H = Path(__file__).parent.parent / "app" / "core" / "instrumenter" / "tracer.h"

BST_SRC = (
    "#include <bits/stdc++.h>\n"
    "using namespace std;\n"
    "struct Node {\n"
    "    int data;\n"
    "    Node* left;\n"
    "    Node* right;\n"
    "    Node(int x) {\n"
    "        data = x;\n"
    "        left = right = nullptr;\n"
    "    }\n"
    "};\n"
    "Node* insert(Node* root, int x) {\n"
    "    if (!root)\n"
    "        return new Node(x);\n"
    "    if (x < root->data)\n"
    "        root->left = insert(root->left, x);\n"
    "    else\n"
    "        root->right = insert(root->right, x);\n"
    "    return root;\n"
    "}\n"
    "int minimum(Node* root) {\n"
    "    while (root->left)\n"
    "        root = root->left;\n"
    "    return root->data;\n"
    "}\n"
    "int maximum(Node* root) {\n"
    "    while (root->right)\n"
    "        root = root->right;\n"
    "    return root->data;\n"
    "}\n"
    "int main() {\n"
    "    int n = 7;\n"
    "    int values[] = {\n"
    "        50, 30, 70, 20, 40, 60, 80\n"
    "    };\n"
    "    Node* root = nullptr;\n"
    "    for (int i = 0; i < n; i++) {\n"
    "        root = insert(root, values[i]);\n"
    "    }\n"
    "    cout << \"Minimum = \" << minimum(root) << '\\n';\n"
    "    cout << \"Maximum = \" << maximum(root) << '\\n';\n"
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


class TestBracedInitState:
    def test_bst_pattern_compiles(self, tmp_path: Path) -> None:
        """RED driver: HEAD splices __TRACE_STATE inside the `= {` init
        list — g++ rejects `expected primary-expression before 'do'`."""
        src = tmp_path / "bst.cpp"
        src.write_text(BST_SRC)
        out = instrument(BST_SRC, str(src))
        code, stderr = _compile(out)
        assert code == 0, f"braced-init state probe failed to compile:\n{stderr}"

    def test_probe_placed_after_init_close(self, tmp_path: Path) -> None:
        """No __TRACE_STATE line may sit between the `= {` header and its
        closing `};`."""
        src = tmp_path / "bst2.cpp"
        src.write_text(BST_SRC)
        out = instrument(BST_SRC, str(src))
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
        assert not leaked, f"probe leaked inside initializer list: {leaked}"

    def test_bst_trace_runs_with_min_max(self, tmp_path: Path) -> None:
        """Instrumented BST binary runs and prints Minimum = 20 / Maximum = 80."""
        src = tmp_path / "bst3.cpp"
        src.write_text(BST_SRC)
        out = instrument(BST_SRC, str(src))
        code, stdout, stderr = _compile_and_run(out)
        assert code == 0, f"instrumented BST binary failed to run:\n{stderr}"
        assert "Minimum = 20" in stdout, f"missing minimum output: {stdout!r}"
        assert "Maximum = 80" in stdout, f"missing maximum output: {stdout!r}"
