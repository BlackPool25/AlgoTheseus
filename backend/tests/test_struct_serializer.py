"""
test_struct_serializer.py — Acceptance tests for serializer_gen (todo 15, T11a).

RED-first: these tests import app.core.instrumenter.serializer_gen, which does
not exist until the implementation lands. They must FAIL (import error) first,
then go GREEN without modification.

Helpers mirror test_serializers.py (local g++ compile, no Docker).
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from pathlib import Path

from app.core.instrumenter import serializer_gen

TRACER_H = Path(__file__).parent.parent / "app" / "core" / "instrumenter" / "tracer.h"
FIXTURES = Path(__file__).parent / "fixtures"


def _compile_and_run_extra(source: str, timeout: int = 5) -> subprocess.CompletedProcess:
    """Compile *source* (already containing tracer.h include + generated code)
    and run it. Returns the CompletedProcess (stdout/stderr/rc)."""
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        src = tmp_path / "prog.cpp"
        src.write_text(source)
        shutil.copy(TRACER_H, tmp_path / "tracer.h")
        binary = tmp_path / "prog"
        compile_result = subprocess.run(
            ["g++", "-O0", "-std=c++17", "-I", str(tmp_path), "-o", str(binary), str(src)],
            capture_output=True, text=True, timeout=30, check=False,
        )
        assert compile_result.returncode == 0, f"Compile error:\n{compile_result.stderr}"
        return subprocess.run(
            [str(binary)], capture_output=True, text=True, timeout=timeout, check=False,
        )


def _gen_for(body_main: str, structs_src: str) -> str:
    """Write a TU with struct defs + main body, run the real codegen on it,
    and return full compilable source (tracer.h + TU + generated code)."""
    with tempfile.TemporaryDirectory() as tmp:
        tu = Path(tmp) / "tu.cpp"
        tu.write_text(structs_src + "\n" + body_main + "\n")
        gen = serializer_gen.generate_serializers(str(tu))
    return '#include "tracer.h"\n#include <iostream>\n' + structs_src + "\n" + gen + "\n" + body_main + "\n"


TREENODE = """\
struct TreeNode {
    int val;
    TreeNode* left;
    TreeNode* right;
};
"""


def test_struct_serializer_emits_id_ref():
    """TreeNode left/right: root carries int $id + $addr; children are full
    objects on first sighting; null child is null."""
    src = _gen_for(
        """\
int main() {
    TreeNode* root = new TreeNode{1, new TreeNode{2, nullptr, nullptr}, nullptr};
    std::cout << __ser(root) << std::endl;
    return 0;
}
""",
        TREENODE,
    )
    proc = _compile_and_run_extra(src)
    assert proc.returncode == 0, f"nonzero exit:\n{proc.stderr}"
    parsed = json.loads(proc.stdout.strip())
    assert isinstance(parsed["$id"], int)
    assert "$addr" in parsed  # additive: old consumers keep working
    assert parsed["val"] == 1
    assert isinstance(parsed["left"]["$id"], int)
    assert parsed["left"]["val"] == 2
    assert parsed["left"]["left"] is None
    assert parsed["right"] is None


SELFREF = """\
struct SelfRef { int val; SelfRef* self; };
"""


def test_cycle_detection():
    """Self-referential struct terminates with a $cycle marker (no hang)."""
    src = _gen_for(
        """\
int main() {
    SelfRef* s = new SelfRef{9, nullptr};
    s->self = s;
    std::cout << __ser(s) << std::endl;
    return 0;
}
""",
        SELFREF,
    )
    # Timeout-guard: a broken visited-set would hang here and fail, never block.
    proc = _compile_and_run_extra(src, timeout=5)
    assert proc.returncode == 0, f"nonzero exit:\n{proc.stderr}"
    parsed = json.loads(proc.stdout.strip())
    assert isinstance(parsed["$id"], int)
    assert parsed["self"] == {"$ref": parsed["$id"], "$cycle": True}


def test_aliasing():
    """Two vars pointing at the same address share one $id."""
    src = _gen_for(
        """\
int main() {
    TreeNode* root = new TreeNode{1, nullptr, nullptr};
    TreeNode* alias = root;
    std::cout << __ser(root) << " " << __ser(alias) << std::endl;
    return 0;
}
""",
        TREENODE,
    )
    proc = _compile_and_run_extra(src)
    assert proc.returncode == 0, f"nonzero exit:\n{proc.stderr}"
    first, second = proc.stdout.strip().split(" ", 1)
    a, b = json.loads(first), json.loads(second)
    assert a["$id"] == b["$id"]
    assert a["$addr"] == b["$addr"]


def test_instrument_without_path_emits_serializers():
    """Production path: instrument() with NO source_path (as execute.py
    calls it) still generates struct serializers."""
    import tempfile as _tf

    from app.core.instrumenter.injector import instrument

    before = set(Path(_tf.gettempdir()).glob("tmp*.cpp"))
    src = TREENODE + "int main(){TreeNode t{1,nullptr,nullptr};return t.val;}\n"
    out = instrument(src)  # no source_path — the production call shape
    assert "__serialize_TreeNode" in out
    assert set(Path(_tf.gettempdir()).glob("tmp*.cpp")) == before  # no leftovers


def test_instrument_without_path_structless_ok():
    """Struct-less source with no path still instruments (no serializers,
    no crash)."""
    from app.core.instrumenter.injector import instrument

    out = instrument("int main(){return 0;}\n")
    assert "__serialize_" not in out
    assert '#include "tracer.h"' in out


def test_instrumented_fixture_trace_carries_id_ref_addr():
    """End-to-end: injector.instrument() on the linked_list fixture compiles
    and its TRACE state values carry $id/$ref + $addr (proves end-of-file
    codegen placement resolves through ADL)."""
    from app.core.instrumenter.injector import instrument

    fixture_src = (FIXTURES / "linked_list.cpp").read_text()
    instrumented = instrument(fixture_src, source_path=str(FIXTURES / "linked_list.cpp"))
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        src = tmp_path / "prog.cpp"
        src.write_text(instrumented)
        shutil.copy(TRACER_H, tmp_path / "tracer.h")
        binary = tmp_path / "prog"
        compile_result = subprocess.run(
            ["g++", "-O0", "-std=c++17", "-I", str(tmp_path),
             "-o", str(binary), str(src)],
            capture_output=True, text=True, timeout=30, check=False,
        )
        assert compile_result.returncode == 0, f"Compile error:\n{compile_result.stderr}"
        run = subprocess.run([str(binary)], capture_output=True, text=True, timeout=10, check=False)
    assert run.returncode == 0, f"nonzero exit:\n{run.stderr}"
    trace_vals = [
        json.loads(line[len("TRACE:"):]) for line in run.stderr.splitlines()
        if line.startswith("TRACE:")
    ]
    states = [e for e in trace_vals if e.get("t") == "state" and e.get("v")]

    def has_identity(obj) -> bool:
        if isinstance(obj, dict):
            if isinstance(obj.get("$id"), int) and "$addr" in obj:
                return True
            return any(has_identity(v) for v in obj.values())
        if isinstance(obj, list):
            return any(has_identity(v) for v in obj)
        return False

    assert states, "expected STATE events with vars"
    assert any(has_identity(e["v"]) for e in states), (
        "no STATE value carries $id + $addr"
    )


def test_single_field_mutation_keeps_others_identical():
    """Mutating one field keeps every other field byte-identical (R6: no
    value corruption; per-$id diff stays meaningful)."""
    src = _gen_for(
        """\
int main() {
    TreeNode* root = new TreeNode{1, new TreeNode{2, nullptr, nullptr}, nullptr};
    std::cout << __ser(root) << std::endl;
    root->val = 42;
    std::cout << __ser(root) << std::endl;
    return 0;
}
""",
        TREENODE,
    )
    proc = _compile_and_run_extra(src)
    assert proc.returncode == 0, f"nonzero exit:\n{proc.stderr}"
    before, after = (json.loads(l) for l in proc.stdout.strip().splitlines())
    assert before["$id"] == after["$id"]  # stable identity across events
    assert after["val"] == 42
    del before["val"], after["val"], before["$id"], after["$id"], before["$addr"], after["$addr"]
    assert before == after
