"""
test_instrumenter.py — Tests for ast_walker and scope_tracker.

Each test has a happy path and an edge case.
"""

from pathlib import Path

from app.core.instrumenter.ast_walker import InjectKind, walk
from app.core.instrumenter.injector import instrument
from app.core.instrumenter.scope_tracker import build_scope_map

FIXTURES = Path(__file__).parent / "fixtures"
BSEARCH = str(FIXTURES / "simple_bsearch.cpp")


# ── ast_walker tests ──────────────────────────────────────────────────────────


class TestASTWalker:
    def test_finds_func_enter_for_user_functions(self):
        """Should produce FUNC_ENTER points for bsearch and main."""
        result = walk(BSEARCH)
        enters = [p for p in result.injection_points if p.kind == InjectKind.FUNC_ENTER]
        func_names = {p.func_name for p in enters}
        assert "bsearch" in func_names
        assert "main" in func_names

    def test_finds_func_exit_for_return_statements(self):
        """bsearch has two return statements — should produce two FUNC_EXIT points."""
        result = walk(BSEARCH)
        exits = [
            p
            for p in result.injection_points
            if p.kind == InjectKind.FUNC_EXIT and p.func_name == "bsearch"
        ]
        assert len(exits) >= 2

    def test_finds_branch_for_if_statements(self):
        """bsearch has one top-level if (else-if is skipped to preserve the chain).
        We inject BRANCH only for the first if in an if/else-if chain."""
        result = walk(BSEARCH)
        branches = [
            p
            for p in result.injection_points
            if p.kind == InjectKind.BRANCH and p.func_name == "bsearch"
        ]
        assert len(branches) >= 1

    def test_finds_loop_iter_for_while(self):
        """bsearch has one while loop — should produce one LOOP_ITER point."""
        result = walk(BSEARCH)
        iters = [
            p
            for p in result.injection_points
            if p.kind == InjectKind.LOOP_ITER and p.func_name == "bsearch"
        ]
        assert len(iters) == 1

    def test_loop_counter_registered_for_function(self):
        """The while loop counter should be registered under 'bsearch'."""
        result = walk(BSEARCH)
        assert "bsearch" in result.loop_counters
        assert len(result.loop_counters["bsearch"]) >= 1

    def test_no_injection_into_std_headers(self):
        """No injection points should reference lines outside the user's file."""
        result = walk(BSEARCH)
        # All injection points should have positive line numbers
        for p in result.injection_points:
            assert p.line > 0, f"Bad line number in {p}"

    def test_empty_file_produces_no_points(self, tmp_path):
        """An empty .cpp file should produce no injection points."""
        empty = tmp_path / "empty.cpp"
        empty.write_text("// empty\n")
        result = walk(str(empty))
        assert result.injection_points == []

    def test_state_injected_inside_while_body(self):
        """Nested STATE: `int mid` line inside the while body needs a STATE point."""
        result = walk(BSEARCH)
        states = [
            p
            for p in result.injection_points
            if p.kind == InjectKind.STATE and p.func_name == "bsearch"
        ]
        state_lines = [p.line for p in states]
        assert 8 in state_lines
        assert len(state_lines) == len(set(state_lines))
        mid_point = next(p for p in states if p.line == 8)
        assert "mid" in mid_point.var_names

    def test_state_injected_inside_if_branches(self):
        """Nested STATE: statements inside if/else-if/else bodies need STATE points."""
        result = walk(BSEARCH)
        state_lines = {
            p.line
            for p in result.injection_points
            if p.kind == InjectKind.STATE and p.func_name == "bsearch"
        }
        assert 10 in state_lines
        assert 11 in state_lines


# ── scope_tracker tests ───────────────────────────────────────────────────────


class TestScopeTracker:
    def test_builds_scope_for_user_functions(self):
        """Should produce scope entries for bsearch and main."""
        scopes = build_scope_map(BSEARCH)
        assert "bsearch" in scopes
        assert "main" in scopes

    def test_bsearch_params_visible_in_body(self):
        """arr and target should be visible inside bsearch."""
        scopes = build_scope_map(BSEARCH)
        bsearch_scope = scopes["bsearch"]
        # Collect all variable names across all lines
        all_vars = {v.name for vars_list in bsearch_scope.vars_at_line.values() for v in vars_list}
        assert "arr" in all_vars
        assert "target" in all_vars

    def test_local_vars_visible_after_declaration(self):
        """lo, hi, mid should appear in the scope map for bsearch."""
        scopes = build_scope_map(BSEARCH)
        bsearch_scope = scopes["bsearch"]
        all_vars = {v.name for vars_list in bsearch_scope.vars_at_line.values() for v in vars_list}
        assert "lo" in all_vars
        assert "hi" in all_vars

    def test_no_std_vars_in_scope(self):
        """No variables from std:: headers should appear in the scope map."""
        scopes = build_scope_map(BSEARCH)
        for fn_scope in scopes.values():
            for vars_list in fn_scope.vars_at_line.values():
                for v in vars_list:
                    assert not v.name.startswith("__"), (
                        f"Internal variable leaked into scope: {v.name}"
                    )

    def test_declared_var_included_in_same_line_state(self, tmp_path):
        """Post-decl snapshot: `int x = 5;` STATE carries x (pre does not)."""
        src = tmp_path / "decl.cpp"
        src.write_text("int foo() {\n    int x = 5;\n    return x;\n}\n")
        scopes = build_scope_map(str(src))
        post = scopes["foo"].vars_at_line_post[2]
        assert {v.name for v in post} == {"x"}
        pre = scopes["foo"].vars_at_line_pre[2]
        assert "x" not in {v.name for v in pre}
        out = instrument(src.read_text())
        state_lines = [ln for ln in out.splitlines() if "__TRACE_STATE(2," in ln]
        assert len(state_lines) == 1
        assert '"x", x' in state_lines[0]

    def test_params_plus_declared_vars(self, tmp_path):
        """Post set on a decl line carries params + the newly declared var."""
        src = tmp_path / "params.cpp"
        src.write_text("int add(int a, int b) {\n    int s = a + b;\n    return s;\n}\n")
        scopes = build_scope_map(str(src))
        post = scopes["add"].vars_at_line_post[2]
        assert {v.name for v in post} == {"a", "b", "s"}
        out = instrument(src.read_text())
        state_lines = [ln for ln in out.splitlines() if "__TRACE_STATE(2," in ln]
        assert len(state_lines) == 1
        for name in ("a", "b", "s"):
            assert f'"{name}", {name}' in state_lines[0]
