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

from dataclasses import dataclass, field
from pathlib import Path
import os

import clang.cindex as clang


def _cursor_kind(cursor: clang.Cursor) -> clang.CursorKind | None:
    """Return cursor.kind, or None if libclang reports an unknown kind id.

    Newer system headers can expose cursor kinds newer than these bindings
    (see ast_walker._cursor_kind). Unknown kinds carry no scope info.
    """
    try:
        return cursor.kind
    except ValueError:
        return None


# R2 (M3): range-for is a distinct cursor kind, not FOR_STMT. getattr guard so
# older bindings without it fall back gracefully (stays None → never matches).
_RANGE_FOR_KIND: clang.CursorKind | None = getattr(
    clang.CursorKind, "CXX_FOR_RANGE_STMT", None
)


def _record_line(scope: FunctionScope, line: int, visible: list[ScopeVar]) -> None:
    """Merge `visible` into scope.vars_at_line[line] (innermost wins)."""
    if line <= 0:
        return
    if line not in scope.vars_at_line:
        scope.vars_at_line[line] = []
    existing_names = {v.name for v in scope.vars_at_line[line]}
    for v in visible:
        if v.name not in existing_names:
            scope.vars_at_line[line].append(v)
            existing_names.add(v.name)


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
        kind = _cursor_kind(cursor)
        if kind in (clang.CursorKind.FUNCTION_DECL, clang.CursorKind.CXX_METHOD) and cursor.is_definition():
            if not self._is_user_code(cursor):
                return
            fn = cursor.spelling
            scope = FunctionScope(func_name=fn)
            scopes[fn] = scope

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
            stmt_kind = _cursor_kind(stmt)
            if stmt_kind is None:
                continue

            # R1 (M2): post-declaration semantics — fold this line's DECL_STMT
            # vars into `visible` BEFORE recording, so declared names appear in
            # their own line's entry (incl. multi-decl `int lo = 0, hi = n`).
            if stmt_kind == clang.CursorKind.DECL_STMT:
                self._append_decl_vars(stmt, visible, depth)
                # Template-type decls (e.g. vector<int>) report the DECL_STMT
                # location in STL headers — record at the user-code VAR_DECL
                # line instead so the entry lands on the real source line.
                _record_line(scope, self._decl_line(stmt), visible)
            else:
                if not self._is_user_code(stmt):
                    continue
                # Record what's visible at this line
                _record_line(scope, stmt.location.line, visible)

                # Nested compound statement (if/loop body) → recurse
                if stmt_kind == clang.CursorKind.COMPOUND_STMT:
                    self._walk_body(stmt, scope, visible, depth + 1)

                # For-loop and range-for: loop vars are scoped to the loop only.
                elif stmt_kind == clang.CursorKind.FOR_STMT or (
                    _RANGE_FOR_KIND is not None and stmt_kind == _RANGE_FOR_KIND
                ):
                    self._walk_loop(stmt, scope, visible, depth)

                # If/loop → recurse into sub-bodies (incl. braceless, see R3)
                elif stmt_kind in (
                    clang.CursorKind.IF_STMT,
                    clang.CursorKind.WHILE_STMT,
                    clang.CursorKind.DO_STMT,
                ):
                    self._walk_cond(stmt, stmt_kind, scope, visible, depth)

    @staticmethod
    def _append_decl_vars(
        decl_stmt: clang.Cursor, visible: list[ScopeVar], depth: int
    ) -> None:
        """Append VAR_DECL children of a DECL_STMT to `visible` (shadow-safe)."""
        for c in decl_stmt.get_children():
            if c.kind == clang.CursorKind.VAR_DECL and c.spelling:
                uid = c.spelling
                if any(v.name == c.spelling for v in visible):
                    uid = f"{c.spelling}_{depth}"
                visible.append(ScopeVar(
                    name=c.spelling,
                    unique_id=uid,
                    decl_line=c.location.line,
                    scope_depth=depth,
                ))

    def _decl_line(self, decl_stmt: clang.Cursor) -> int:
        """Line to attribute a DECL_STMT's scope entry to (user-code VAR_DECL)."""
        for c in decl_stmt.get_children():
            if c.kind == clang.CursorKind.VAR_DECL and c.spelling:
                loc = c.location
                if loc.file is not None and loc.line > 0:
                    try:
                        if os.path.abspath(loc.file.name) == self.source_path:
                            return loc.line
                    except ValueError:
                        pass
        return decl_stmt.location.line

    def _walk_loop(
        self,
        stmt: clang.Cursor,
        scope: FunctionScope,
        visible: list[ScopeVar],
        depth: int,
    ) -> None:
        """Walk FOR_STMT / CXX_FOR_RANGE_STMT: loop-var scope + body."""
        loop_visible = list(visible)

        # Capture init declarations (`for (int i = 0; ...)`) and the range-for
        # loop var (direct VAR_DECL child of CXX_FOR_RANGE_STMT).
        for child in stmt.get_children():
            if child.kind == clang.CursorKind.DECL_STMT:
                self._append_decl_vars(child, loop_visible, depth)
            elif child.kind == clang.CursorKind.VAR_DECL and child.spelling:
                uid = child.spelling
                if any(v.name == child.spelling for v in loop_visible):
                    uid = f"{child.spelling}_{depth}"
                loop_visible.append(ScopeVar(
                    name=child.spelling,
                    unique_id=uid,
                    decl_line=child.location.line,
                    scope_depth=depth,
                ))

        # Ensure loop header line records newly added vars
        _record_line(scope, stmt.location.line, loop_visible)

        # Body is the last child; a lone statement is a braceless body (R3).
        children = list(stmt.get_children())
        if not children:
            return
        body = children[-1]
        if _cursor_kind(body) == clang.CursorKind.COMPOUND_STMT:
            self._walk_body(body, scope, loop_visible, depth + 1)
        else:
            self._walk_braceless_body(body, scope, loop_visible, depth + 1)

    def _walk_cond(
        self,
        stmt: clang.Cursor,
        stmt_kind: clang.CursorKind,
        scope: FunctionScope,
        visible: list[ScopeVar],
        depth: int,
    ) -> None:
        """Walk IF/WHILE/DO sub-bodies, recursing into braceless bodies (R3)."""
        children = list(stmt.get_children())
        if stmt_kind == clang.CursorKind.IF_STMT:
            bodies = children[1:]  # then + else (children[0] is the condition)
        elif stmt_kind == clang.CursorKind.DO_STMT:
            bodies = children[:1]  # body first, condition second
        else:  # WHILE_STMT: condition first, body last
            bodies = children[1:]
        for body in bodies:
            if _cursor_kind(body) == clang.CursorKind.COMPOUND_STMT:
                self._walk_body(body, scope, visible, depth + 1)
            else:
                self._walk_braceless_body(body, scope, visible, depth + 1)

    def _walk_braceless_body(
        self,
        node: clang.Cursor,
        scope: FunctionScope,
        visible: list[ScopeVar],
        depth: int,
    ) -> None:
        """Record scope for a single-statement body; recurse if nested control."""
        _record_line(scope, node.location.line, visible)
        kind = _cursor_kind(node)
        if kind == clang.CursorKind.FOR_STMT or (
            _RANGE_FOR_KIND is not None and kind == _RANGE_FOR_KIND
        ):
            self._walk_loop(node, scope, visible, depth)
        elif kind in (
            clang.CursorKind.IF_STMT,
            clang.CursorKind.WHILE_STMT,
            clang.CursorKind.DO_STMT,
        ):
            self._walk_cond(node, kind, scope, visible, depth)
        elif kind == clang.CursorKind.COMPOUND_STMT:
            self._walk_body(node, scope, visible, depth + 1)


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
