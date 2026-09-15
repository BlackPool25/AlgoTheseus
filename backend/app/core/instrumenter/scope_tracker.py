"""
scope_tracker.py — Tracks which variables are in scope at each injection point.

The AST walker collects injection points but doesn't always know which variables
are visible at each point. This module does a second pass over the AST to build
a scope map: for each function, a list of (line, variable_name) pairs in
declaration order.

The injector uses this to decide what to pass to __TRACE_STATE().

Gotcha: C++ has block scope — a variable declared inside an if-body is not
visible after the closing brace. We model this with a simple stack of scopes.

Gotcha: We assign unique IDs to variables with the same name in nested scopes
(e.g., two `i` variables in nested loops). The frontend shows the innermost one.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field

import clang.cindex as clang

from app.core.instrumenter import _libclang_compat

_libclang_compat.ensure_libclang()


@dataclass
class ScopeVar:
    """A variable visible at a particular point in the source."""
    name: str
    unique_id: str      # name + scope depth suffix for disambiguation
    decl_line: int      # line where it was declared
    scope_depth: int    # nesting depth (0 = function params, 1 = function body, ...)


@dataclass
class FunctionScope:
    """All variables visible at each line within a function."""
    func_name: str
    # Maps line number → list of ScopeVar visible at that line
    vars_at_line: dict[int, list[ScopeVar]] = field(default_factory=dict)
    # Pre-declaration snapshot: visible just before the line executes
    # (a DECL_STMT's own names are NOT in its line's pre set).
    vars_at_line_pre: dict[int, list[ScopeVar]] = field(default_factory=dict)
    # Post-declaration snapshot: pre + names declared on the line itself.
    # STATE injection reads this, so `int x = 5;` captures x. Built only
    # from decls on that same line — never leaks out-of-scope names.
    vars_at_line_post: dict[int, list[ScopeVar]] = field(default_factory=dict)


class ScopeTracker:
    """Builds a scope map for all user-defined functions in a source file.

    Args:
        source_path: Absolute path to the .cpp file.
        extra_args: Additional clang flags.
    """

    def __init__(self, source_path: str, extra_args: list[str] | None = None):
        self.source_path = os.path.abspath(source_path)
        self.extra_args = extra_args or ["-std=c++17", "-O0"]
        self._index = clang.Index.create()

    def build(self) -> dict[str, FunctionScope]:
        """Parse the source and return a scope map per function.

        Returns:
            Dict mapping function name → FunctionScope.
        """
        tu = self._index.parse(self.source_path, args=self.extra_args)
        scopes: dict[str, FunctionScope] = {}
        self._visit(tu.cursor, scopes)
        return scopes

    def _is_user_code(self, cursor: clang.Cursor) -> bool:
        loc = cursor.location
        return (
            loc.file is not None
            and os.path.abspath(loc.file.name) == self.source_path
        )

    def _visit(self, cursor: clang.Cursor, scopes: dict[str, FunctionScope]) -> None:
        if cursor.kind in (clang.CursorKind.FUNCTION_DECL, clang.CursorKind.CXX_METHOD) and cursor.is_definition():
            if not self._is_user_code(cursor):
                return
            fn = cursor.spelling
            scope = FunctionScope(func_name=fn)
            scopes[fn] = scope
            # vars_at_line is the pre snapshot (backward-compatible alias).
            scope.vars_at_line = scope.vars_at_line_pre

            # Collect params as scope depth 0
            params: list[ScopeVar] = []
            for c in cursor.get_children():
                if c.kind == clang.CursorKind.PARM_DECL and c.spelling:
                    params.append(ScopeVar(
                        name=c.spelling,
                        unique_id=c.spelling,
                        decl_line=c.location.line,
                        scope_depth=0,
                    ))

            # Walk the body with a scope stack
            body = next(
                (c for c in cursor.get_children()
                 if c.kind == clang.CursorKind.COMPOUND_STMT),
                None,
            )
            if body:
                self._walk_body(body, scope, list(params), depth=1)
            return

        for child in cursor.get_children():
            self._visit(child, scopes)

    def _record_line(
        self,
        scope: FunctionScope,
        line: int,
        visible: list[ScopeVar],
    ) -> None:
        if line not in scope.vars_at_line:
            scope.vars_at_line[line] = []
        existing_names = {v.name for v in scope.vars_at_line[line]}
        for v in visible:
            if v.name not in existing_names:
                scope.vars_at_line[line].append(v)
                existing_names.add(v.name)
        if line not in scope.vars_at_line_post:
            scope.vars_at_line_post[line] = list(scope.vars_at_line[line])

    def _add_post_decls(
        self,
        scope: FunctionScope,
        line: int,
        new_vars: list[ScopeVar],
    ) -> None:
        post = scope.vars_at_line_post.setdefault(line, [])
        by_name = {v.name: i for i, v in enumerate(post)}
        for v in new_vars:
            if v.name in by_name:
                post[by_name[v.name]] = v
            else:
                post.append(v)

    def _walk_control_child(
        self,
        child: clang.Cursor,
        scope: FunctionScope,
        visible: list[ScopeVar],
        depth: int,
    ) -> None:
        if child.kind == clang.CursorKind.COMPOUND_STMT:
            self._walk_body(child, scope, visible, depth + 1)
        elif child.kind in (
            clang.CursorKind.IF_STMT,
            clang.CursorKind.WHILE_STMT,
            clang.CursorKind.DO_STMT,
            clang.CursorKind.FOR_STMT,
        ):
            if self._is_user_code(child):
                self._record_line(scope, child.location.line, visible)
            for grandchild in child.get_children():
                self._walk_control_child(grandchild, scope, visible, depth)
        elif self._is_user_code(child) and child.location.line:
            self._record_line(scope, child.location.line, visible)

    def _walk_body(
        self,
        cursor: clang.Cursor,
        scope: FunctionScope,
        visible: list[ScopeVar],
        depth: int,
    ) -> None:
        """Walk a compound statement, tracking variable declarations."""
        # visible is a copy — mutations don't escape this scope
        visible = list(visible)

        for stmt in cursor.get_children():
            # Process all DECL_STMT regardless of file origin (template types
            # like vector<int> may report cursor location in STL headers).
            # For non-declaration statements, filter by user code as usual.
            if stmt.kind != clang.CursorKind.DECL_STMT and not self._is_user_code(stmt):
                continue

            # Record what's visible at this line (pre snapshot; post inits as its copy)
            line = stmt.location.line
            self._record_line(scope, line, visible)

            # Variable declaration → add to visible scope + own line's post set
            if stmt.kind == clang.CursorKind.DECL_STMT:
                new_vars: list[ScopeVar] = []
                for c in stmt.get_children():
                    if c.kind == clang.CursorKind.VAR_DECL and c.spelling:
                        # Check for shadowing
                        uid = c.spelling
                        if any(v.name == c.spelling for v in visible):
                            uid = f"{c.spelling}_{depth}"
                        sv = ScopeVar(
                            name=c.spelling,
                            unique_id=uid,
                            decl_line=c.location.line,
                            scope_depth=depth,
                        )
                        visible.append(sv)
                        new_vars.append(sv)
                self._add_post_decls(scope, line, new_vars)

            # Nested compound statement (if/loop body) → recurse with new scope
            elif stmt.kind == clang.CursorKind.COMPOUND_STMT:
                self._walk_body(stmt, scope, visible, depth + 1)

            # For-loop init can declare variables; include them in scope
            elif stmt.kind == clang.CursorKind.FOR_STMT:
                # for-loop init vars are scoped to the loop only, not after it.
                loop_visible = list(visible)
                loop_new: list[ScopeVar] = []

                # Capture init declarations like: for (int i = 0; ...)
                for child in stmt.get_children():
                    if child.kind == clang.CursorKind.DECL_STMT:
                        for c in child.get_children():
                            if c.kind == clang.CursorKind.VAR_DECL and c.spelling:
                                uid = c.spelling
                                if any(v.name == c.spelling for v in loop_visible):
                                    uid = f"{c.spelling}_{depth}"
                                sv = ScopeVar(
                                    name=c.spelling,
                                    unique_id=uid,
                                    decl_line=c.location.line,
                                    scope_depth=depth,
                                )
                                loop_visible.append(sv)
                                loop_new.append(sv)
                    elif child.kind == clang.CursorKind.VAR_DECL and child.spelling:
                        uid = child.spelling
                        if any(v.name == child.spelling for v in loop_visible):
                            uid = f"{child.spelling}_{depth}"
                        sv = ScopeVar(
                            name=child.spelling,
                            unique_id=uid,
                            decl_line=child.location.line,
                            scope_depth=depth,
                        )
                        loop_visible.append(sv)
                        loop_new.append(sv)

                # The for line's post set carries the loop vars; outer visible is untouched.
                self._add_post_decls(scope, line, loop_new)

                # Recurse into loop body with loop-scoped visibility
                for child in stmt.get_children():
                    if child.kind == clang.CursorKind.COMPOUND_STMT:
                        self._walk_body(child, scope, loop_visible, depth + 1)

            # If/loop → recurse into sub-bodies (compounds get a new scope,
            # single-statement bodies share the current one)
            elif stmt.kind in (
                clang.CursorKind.IF_STMT,
                clang.CursorKind.WHILE_STMT,
                clang.CursorKind.DO_STMT,
            ):
                for child in stmt.get_children():
                    self._walk_control_child(child, scope, visible, depth)


def build_scope_map(
    source_path: str,
    extra_args: list[str] | None = None,
) -> dict[str, FunctionScope]:
    """Convenience function — build the scope map for a source file.

    Args:
        source_path: Path to the .cpp file.
        extra_args: Additional clang flags.

    Returns:
        Dict mapping function name → FunctionScope.
    """
    return ScopeTracker(source_path, extra_args).build()
