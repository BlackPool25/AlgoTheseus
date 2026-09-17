"""
test_scope_loops.py — RED-first tests for loop-scope fixes R1-R4 (M2-M5).
"""

from pathlib import Path

from app.core.instrumenter.ast_walker import InjectKind, walk
from app.core.instrumenter.injector import instrument
from app.core.instrumenter.scope_tracker import build_scope_map

FIXTURES = Path(__file__).parent / "fixtures"
BSEARCH = str(FIXTURES / "simple_bsearch.cpp")


def _write(tmp_path, name: str, body: str) -> str:
    p = tmp_path / name
    p.write_text(body)
    return str(p)


def _names(scopes, fn: str, line: int) -> list[str]:
    return [v.name for v in scopes[fn].vars_at_line.get(line, [])]


class TestR1PostDecl:
    def test_declared_var_in_same_line_state(self, tmp_path):
        src = _write(
            tmp_path,
            "r1.cpp",
            "int f() {\n    int mid = 5;\n"
            "    int after = mid + 1;\n    return after;\n}\n",
        )
        assert "mid" in _names(build_scope_map(src), "f", 2)

    def test_multi_decl_same_line(self, tmp_path):
        src = _write(
            tmp_path,
            "r1m.cpp",
            "int f() {\n    int lo = 0, hi = 3;\n    return lo + hi;\n}\n",
        )
        names = _names(build_scope_map(src), "f", 2)
        assert "lo" in names and "hi" in names

    def test_bsearch_mid_present_line8(self):
        assert "mid" in _names(build_scope_map(BSEARCH), "bsearch", 8)

    def test_bsearch_lo_hi_present_line6(self):
        names = _names(build_scope_map(BSEARCH), "bsearch", 6)
        assert "lo" in names and "hi" in names


class TestR2RangeFor:
    SRC = (
        "int range_carray_fn() {\n"
        "    int buf[4] = {1, 2, 3, 4};\n"
        "    int total = 0;\n"
        "    for (int x : buf) {\n"
        "        total += x;\n"
        "    }\n"
        "    return total;\n"
        "}\n"
    )

    def test_range_for_carray_scope(self, tmp_path):
        import clang.cindex as clang

        if not hasattr(clang.CursorKind, "CXX_FOR_RANGE_STMT"):
            return
        src = _write(tmp_path, "r2.cpp", self.SRC)
        scopes = build_scope_map(src)
        assert "x" in _names(scopes, "range_carray_fn", 4)
        body = _names(scopes, "range_carray_fn", 5)
        assert body, "range-for body line has no scope entry"
        assert "x" in body and "total" in body

    def test_range_for_walker_emits_state(self, tmp_path):
        import clang.cindex as clang

        if not hasattr(clang.CursorKind, "CXX_FOR_RANGE_STMT"):
            return
        src = _write(tmp_path, "r2w.cpp", self.SRC)
        result = walk(src)
        states = [
            p
            for p in result.injection_points
            if p.kind == InjectKind.STATE and p.line == 5
        ]
        assert states, "walker emits no STATE for range-for body line"
        assert result.loop_counters.get("range_carray_fn"), "no loop counter allocated"


class TestR2RangeForSTL:
    """W0.1 toolchain pin: STL range-for over std::vector<int> must parse.

    Pre-fix libclang 18 misses GCC 16's internal headers (`stddef.h` not
    found via c++/16/cstddef) so both loops are structurally invisible
    (zero loop nodes, scope map jumps decl → return).
    """

    SRC = (
        "#include <vector>\n"
        "int stl_range_fn() {\n"
        "    std::vector<int> vec = {1, 2, 3};\n"
        "    int total = 0;\n"
        "    for (int x : vec) {\n"
        "        total += x;\n"
        "    }\n"
        "    for (auto& y : vec) {\n"
        "        total += y;\n"
        "    }\n"
        "    return total;\n"
        "}\n"
    )

    def test_stl_range_for_scope(self, tmp_path):
        import clang.cindex as clang

        if not hasattr(clang.CursorKind, "CXX_FOR_RANGE_STMT"):
            return
        src = _write(tmp_path, "r2stl.cpp", self.SRC)
        scopes = build_scope_map(src)
        assert "x" in _names(scopes, "stl_range_fn", 5)
        body = _names(scopes, "stl_range_fn", 6)
        assert body, "STL range-for body line has no scope entry"
        assert "x" in body and "total" in body
        assert "y" in _names(scopes, "stl_range_fn", 8)

    def test_stl_range_for_walker_emits_loops(self, tmp_path):
        import clang.cindex as clang

        if not hasattr(clang.CursorKind, "CXX_FOR_RANGE_STMT"):
            return
        src = _write(tmp_path, "r2stlw.cpp", self.SRC)
        result = walk(src)
        states = [
            p
            for p in result.injection_points
            if p.kind == InjectKind.STATE and p.line in (6, 9)
        ]
        assert states, "walker emits no STATE for STL range-for body lines"
        iters = [p for p in result.injection_points if p.kind == InjectKind.LOOP_ITER]
        assert len(iters) == 2, f"expected 2 LOOP_ITER, got {len(iters)}"


class TestR3Braceless:
    SRC = (
        "int split_braceless_fn(int n) {\n"
        "    int x = 0;\n"
        "    for (int k = 0; k < n; ++k)\n"
        "        x += k;\n"
        "    while (x < 100)\n"
        "        x++;\n"
        "    if (x > 0)\n"
        "        x = 1;\n"
        "    return x;\n"
        "}\n"
    )

    def test_braceless_body_scope(self, tmp_path):
        src = _write(tmp_path, "r3.cpp", self.SRC)
        scopes = build_scope_map(src)
        for line in (4, 6, 8):
            assert scopes["split_braceless_fn"].vars_at_line.get(
                line
            ), f"braceless body line {line} has no scope entry"
        assert "x" in _names(scopes, "split_braceless_fn", 4)


class TestR4ReturnState:
    def test_return_line_state_present(self, tmp_path):
        src = _write(
            tmp_path,
            "r4.cpp",
            "int f() {\n    int a = 1;\n    int b = a + 1;\n    return b;\n}\n",
        )
        out = instrument(open(src).read(), src)
        assert "__TRACE_STATE(4" in out, "no STATE snapshot on return line"
