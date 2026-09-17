from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from app.core.instrumenter.injector import instrument


@pytest.mark.parametrize(
    "body",
    [
        "Node* p = new Node{1, nullptr}; Node* alias = p; delete p;",
        "Node* p = new Node{1, new Node{2, nullptr}}; delete p->next;",
        "Node* p = new Node{1, nullptr}; std::vector<Node*> aliases{p, p}; delete p;",
    ],
)
def test_deleted_struct_aliases_are_not_dereferenced(body: str, tmp_path: Path) -> None:
    source = instrument(
        "#include <vector>\n#include <iostream>\n"
        "struct Node { int value; Node* next; };\n"
        "int main() {\n" + body.replace("; ", ";\n") + '\nstd::cout << "done\\n";\nreturn 0;\n}\n'
    )
    path = tmp_path / "main.cpp"
    path.write_text(source)
    compiler = shutil.which("clang++") or "g++"
    binary = tmp_path / "main"
    compiled = subprocess.run(
        [
            compiler,
            "-std=c++17",
            "-O0",
            "-g",
            "-I",
            str(Path(__file__).parents[1] / "app/core/instrumenter"),
            str(path),
            "-o",
            str(binary),
        ],
        capture_output=True,
        text=True,
        check=False,
        timeout=30,
    )
    assert compiled.returncode == 0, compiled.stderr
    run = subprocess.run([str(binary)], capture_output=True, text=True, check=False, timeout=10)
    assert run.returncode == 0, run.stderr
    assert run.stdout == "done\n"
    events = [json.loads(line[6:]) for line in run.stderr.splitlines() if line.startswith("TRACE:")]
    assert events
    assert any('"$freed": true' in json.dumps(event) for event in events)
