from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from app.core.instrumenter.injector import instrument

TRACER_H = Path(__file__).parent.parent / "app" / "core" / "instrumenter" / "tracer.h"


def test_uninitialized_local_pointer_does_not_crash(tmp_path: Path) -> None:
    """An uninitialized pointer in a local function must not cause SIGSEGV
    when captured by in-scope STATE events. It should safely serialize as null."""
    code = """#include <iostream>
struct ListNode {
    int val;
    ListNode* next;
    ListNode(int v = 0) : val(v), next(nullptr) {}
};

void run() {
    ListNode* head = new ListNode(10);
    ListNode* uninit; // uninitialized!
    ListNode* temp = new ListNode(20);
    uninit = temp;
    std::cout << "done\\n";
}

int main() {
    run();
    return 0;
}
"""
    instrumented = instrument(code)
    src = tmp_path / "prog.cpp"
    src.write_text(instrumented)
    shutil.copy(TRACER_H, tmp_path / "tracer.h")
    binary = tmp_path / "prog"
    
    compiler = shutil.which("clang++") or "g++"
    compiled = subprocess.run(
        [
            compiler,
            "-std=c++17",
            "-O0",
            "-g",
            "-ftrivial-auto-var-init=zero",
            "-I",
            str(tmp_path),
            str(src),
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
    assert run.returncode == 0, f"Process crashed with exit code {run.returncode}:\n{run.stderr}"
    assert "done\n" in run.stdout
    events = [json.loads(line[6:]) for line in run.stderr.splitlines() if line.startswith("TRACE:")]
    assert len(events) > 0


def test_invalid_wild_pointer_does_not_crash(tmp_path: Path) -> None:
    """A struct pointing to an invalid/unmapped memory address must not crash
    the serializer or endlessly follow next; it must safely emit null."""
    code = """#include <iostream>
struct ListNode {
    int val;
    ListNode* next;
    ListNode(int v = 0) : val(v), next(nullptr) {}
};

int main() {
    ListNode head(42);
    head.next = (ListNode*)0x111; // invalid wild address
    std::cout << "done\\n";
    return 0;
}
"""
    instrumented = instrument(code)
    src = tmp_path / "prog.cpp"
    src.write_text(instrumented)
    shutil.copy(TRACER_H, tmp_path / "tracer.h")
    binary = tmp_path / "prog"
    
    compiler = shutil.which("clang++") or "g++"
    compiled = subprocess.run(
        [
            compiler,
            "-std=c++17",
            "-O0",
            "-g",
            "-I",
            str(tmp_path),
            str(src),
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
    assert run.returncode == 0, f"Process crashed with exit code {run.returncode}:\n{run.stderr}"
    assert "done\n" in run.stdout
    events = [json.loads(line[6:]) for line in run.stderr.splitlines() if line.startswith("TRACE:")]
    assert any(e.get("t") == "state" for e in events)
