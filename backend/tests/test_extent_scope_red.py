"""test_extent_scope_red.py — Wave 2c RED: extent-based scope safety.

Covers three gaps in line-only scope tracking:

1. Same-line siblings: `int a=1; int b=2;` — the line's pre-snapshot is
   taken before the FIRST declarator runs, so NEITHER `a` nor `b` may
   appear in `vars_at_line_pre[line]` (later-decl merge must not leak in).
2. Multi-line body leak: a block-scoped var (e.g. `q` declared inside an
   if-body) must drop out of `_trace_state` once the emission placement
   moves past the block's `extent.end` (half-open `[decl, extent_end)`).
3. Nested same-name loops: inner `i` shadows outer `i`; ranges nest, the
   inner body keeps `i`, placement past BOTH loops drops it, and the
   instrumented source still compiles with g++.

Tests 1+2 MUST FAIL on pre-fix code (file-level RED). Test 3 locks the
loop_var_ranges nesting behaviour + compile safety across the fix.
"""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

from app.core.instrumenter.ast_walker import InjectionPoint, InjectKind
from app.core.instrumenter.injector import _trace_state, instrument
from app.core.instrumenter.scope_tracker import build_scope_map

TRACER_H = Path(__file__).parent.parent / "app" / "core" / "instrumenter" / "tracer.h"


def _write(tmp_path: Path, name: str, src: str) -> str:
    p = tmp_path / name
    p.write_text(src)
    return str(p)


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


SIBLING_SRC = "int f() {\n    int a=1; int b=2;\n    return a+b;\n}\n"

BLOCK_SRC = (
    "int f(int n) {\n"      # line 1
    "    if (n > 0) {\n"    # line 2
    "        int q = 5;\n"  # line 3
    "        int r = q + n;\n"  # line 4
    "    }\n"               # line 5
    "    int after = 1;\n"  # line 6
    "    return after + n;\n"  # line 7
    "}\n"                  # line 8
)

NESTED_SRC = (
    "int h() {\n"                    # line 1
    "    int s=0;\n"                 # line 2
    "    for (int i=0;i<2;++i) {\n"  # line 3 outer
    "        for (int i=0;i<2;++i) {\n"  # line 4 inner
    "            s+=i;\n"            # line 5
    "        }\n"                    # line 6
    "    }\n"                       # line 7
    "    return s;\n"                # line 8
    "}\n"                           # line 9
)


class TestSameLineSiblingsPre:
    def test_pre_snapshot_excludes_own_line_decls(self, tmp_path: Path) -> None:
        """Pre-snapshot for the shared line must hold neither sibling.

        RED driver: pre-fix merges the second DECL_STMT's pre (which sees
        `a`) into the line entry, so `a` leaks into its own line's pre set.
        """
        src = _write(tmp_path, "sib.cpp", SIBLING_SRC)
        scopes = build_scope_map(src)
        pre_names = {v.name for v in scopes["f"].vars_at_line_pre.get(2, [])}
        assert "b" not in pre_names, f"`b` leaked into `a`'s pre-snapshot: {pre_names}"
        assert "a" not in pre_names, f"`a` leaked into its own pre-snapshot: {pre_names}"

    def test_post_snapshot_keeps_both_and_compiles(self, tmp_path: Path) -> None:
        """Post (R1) still carries both siblings; instrumented code compiles."""
        src = _write(tmp_path, "sib2.cpp", SIBLING_SRC)
        scopes = build_scope_map(src)
        post_names = {v.name for v in scopes["f"].vars_at_line_post.get(2, [])}
        assert {"a", "b"} <= post_names
        prog = SIBLING_SRC + "int main(){return f();}\n"
        out = instrument(prog, _write(tmp_path, "sib2prog.cpp", prog))
        code, stderr = _compile(out)
        assert code == 0, f"sibling instrumented source failed to compile:\n{stderr}"


class TestMultilineBodyLeak:
    def test_block_var_dropped_past_extent_end(self, tmp_path: Path) -> None:
        """STATE anchored in-block but placed past `}` must drop `q`/`r`.

        RED driver: pre-fix `_trace_state` has no block-extent filter, so
        the emission references dead `q` (would not compile at that site).
        """
        src = _write(tmp_path, "blk.cpp", BLOCK_SRC)
        scopes = build_scope_map(src)
        scope = scopes["f"]
        post_names = {v.name for v in scope.vars_at_line_post.get(4, [])}
        assert {"q", "r"} <= post_names  # anchor really sees the block vars
        point = InjectionPoint(kind=InjectKind.STATE, line=4, col=1,
                               func_name="f", depth=0)
        out = _trace_state(point, scope, None, 6)
        assert '"q"' not in out, f"block var `q` leaked past extent end: {out}"
        assert '"r"' not in out, f"block var `r` leaked past extent end: {out}"
        assert '"n"' in out, f"live param `n` must survive: {out}"

    def test_block_var_kept_inside_extent(self, tmp_path: Path) -> None:
        """Same anchor placed inside the block keeps the block vars (no R1 change)."""
        src = _write(tmp_path, "blk2.cpp", BLOCK_SRC)
        scope = build_scope_map(src)["f"]
        point = InjectionPoint(kind=InjectKind.STATE, line=4, col=1,
                               func_name="f", depth=0)
        out = _trace_state(point, scope, None, 4)
        assert '"q"' in out and '"r"' in out, f"in-extent vars dropped: {out}"


class TestNestedSameNameLoops:
    def test_nested_intervals_recorded(self, tmp_path: Path) -> None:
        src = _write(tmp_path, "nest.cpp", NESTED_SRC)
        scope = build_scope_map(src)["h"]
        assert sorted(scope.loop_var_ranges.get("i", [])) == [(3, 7), (4, 6)]

    def test_inner_body_keeps_i_past_both_drops(self, tmp_path: Path) -> None:
        src = _write(tmp_path, "nest2.cpp", NESTED_SRC)
        scope = build_scope_map(src)["h"]
        point = InjectionPoint(kind=InjectKind.STATE, line=5, col=1,
                               func_name="h", depth=0)
        assert '"i"' in _trace_state(point, scope, None, 5)
        assert '"i"' not in _trace_state(point, scope, None, 8)

    def test_nested_same_name_compiles(self, tmp_path: Path) -> None:
        prog = NESTED_SRC + "int main(){return h();}\n"
        src = _write(tmp_path, "nest3.cpp", prog)
        out = instrument(prog, src)
        code, stderr = _compile(out)
        assert code == 0, f"nested same-name instrumented source failed to compile:\n{stderr}"
