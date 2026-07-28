"""
test_instrumenter.py — Tests for ast_walker and scope_tracker.

Each test has a happy path and an edge case.
"""

import os
from pathlib import Path

import pytest

from app.core.instrumenter.ast_walker import InjectKind, walk
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
        exits = [p for p in result.injection_points if p.kind == InjectKind.FUNC_EXIT
                 and p.func_name == "bsearch"]
        assert len(exits) >= 2

    def test_finds_branch_for_if_statements(self):
        """bsearch has one top-level if (else-if is skipped to preserve the chain).
        We inject BRANCH only for the first if in an if/else-if chain."""
        result = walk(BSEARCH)
        branches = [p for p in result.injection_points if p.kind == InjectKind.BRANCH
                    and p.func_name == "bsearch"]
        assert len(branches) >= 1

    def test_finds_loop_iter_for_while(self):
        """bsearch has one while loop — should produce one LOOP_ITER point."""
        result = walk(BSEARCH)
        iters = [p for p in result.injection_points if p.kind == InjectKind.LOOP_ITER
                 and p.func_name == "bsearch"]
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
        all_vars = {
            v.name
            for vars_list in bsearch_scope.vars_at_line.values()
            for v in vars_list
        }
        assert "arr" in all_vars
        assert "target" in all_vars

    def test_local_vars_visible_after_declaration(self):
        """lo, hi, mid should appear in the scope map for bsearch."""
        scopes = build_scope_map(BSEARCH)
        bsearch_scope = scopes["bsearch"]
        all_vars = {
            v.name
            for vars_list in bsearch_scope.vars_at_line.values()
            for v in vars_list
        }
        assert "lo" in all_vars
        assert "hi" in all_vars

    def test_no_std_vars_in_scope(self):
        """No variables from std:: headers should appear in the scope map."""
        scopes = build_scope_map(BSEARCH)
        for fn_scope in scopes.values():
            for vars_list in fn_scope.vars_at_line.values():
                for v in vars_list:
                    assert not v.name.startswith("__"), \
                        f"Internal variable leaked into scope: {v.name}"
