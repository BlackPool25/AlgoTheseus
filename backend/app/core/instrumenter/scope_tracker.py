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
from app.core.instrumenter.diagnostics import (
    collect_diagnostics,
    parse_with_diagnostics,
)

_libclang_compat.ensure_libclang()


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
_RANGE_FOR_KIND: clang.CursorKind | None = getattr(clang.CursorKind, "CXX_FOR_RANGE_STMT", None)
_DECOMP_KIND: clang.CursorKind | None = getattr(clang.CursorKind, "DECOMPOSITION_DECL", None)
_BINDING_DECL_KIND: clang.CursorKind | None = getattr(clang.CursorKind, "BINDING_DECL", None)

_TRY_CATCH_KINDS: tuple = tuple(
    k
    for k in (
        getattr(clang.CursorKind, "CXX_TRY_STMT", None),
        getattr(clang.CursorKind, "CXX_CATCH_STMT", None),
    )
    if k is not None
)
_LAMBDA_KIND: clang.CursorKind | None = getattr(clang.CursorKind, "LAMBDA_EXPR", None)

_TEMPLATE_DEF_KINDS: tuple = tuple(
    k
    for k in (
        getattr(clang.CursorKind, "CLASS_TEMPLATE", None),
        getattr(clang.CursorKind, "CLASS_TEMPLATE_PARTIAL_SPECIALIZATION", None),
        getattr(clang.CursorKind, "FUNCTION_TEMPLATE", None),
    )
    if k is not None
)


@dataclass
class ScopeVar:
    """A variable visible at a particular point in the source."""

    name: str
    unique_id: str  # name + scope depth suffix for disambiguation
    decl_line: int  # user-file line where it was declared (see _decl_line)
    scope_depth: int  # nesting depth (0 = function params, 1 = function body, ...)
    extent_end: int = 0  # enclosing-scope end line; live iff decl <= place < end.
    # 0 = unbounded (function params, alive for the whole body).


@dataclass
class FunctionScope:
    """All variables visible at each line within a function."""

    func_name: str
    # Maps line number → list of ScopeVar visible at that line.
    # POST-declaration semantics (R1): names declared on the line itself ARE
    # included, so `int mid = ...` is present on its own line's entry.
    vars_at_line: dict[int, list[ScopeVar]] = field(default_factory=dict)
    # Pre-declaration snapshot: visible just before the line executes
    # (a DECL_STMT's own names are NOT in its line's pre set).
    vars_at_line_pre: dict[int, list[ScopeVar]] = field(default_factory=dict)
    # Post-declaration snapshot: pre + names declared on the line itself.
    # STATE injection reads this, so `int x = 5;` captures x. Built only
    # from decls on that same line — never leaks out-of-scope names.
    # Mirrors vars_at_line content.
    vars_at_line_post: dict[int, list[ScopeVar]] = field(default_factory=dict)
    # Loop-var lifetime intervals per name: name → [(header_line, body_end)].
    # A header-declared var (for-init / range-for) is only alive within its
    # own loop span; the injector drops it when the STATE placement falls
    # outside ALL intervals (nested same-name loops append intervals).
    loop_var_ranges: dict[str, list[tuple[int, int]]] = field(default_factory=dict)


class ScopeTracker:
    """Builds a scope map for all user-defined functions in a source file.

    Args:
        source_path: Absolute path to the .cpp file.
        extra_args: Additional clang flags.
    """

    def __init__(self, source_path: str, extra_args: list[str] | None = None):
        self.source_path = os.path.abspath(source_path)
        # W0.1 pin: same shared default as the walker (see ast_walker).
        self.extra_args = (
            extra_args if extra_args is not None else _libclang_compat.default_extra_args()
        )
        self._index = clang.Index.create()
        self.last_diagnostics: list[str] = []

    def build(self) -> dict[str, FunctionScope]:
        """Parse the source and return a scope map per function.

        Returns:
            Dict mapping function name → FunctionScope.
        """
        tu = parse_with_diagnostics(self._index, self.source_path, self.extra_args)
        self.last_diagnostics = collect_diagnostics(tu)
        scopes: dict[str, FunctionScope] = {}
        self._visit(tu.cursor, scopes)
        return scopes

    def _is_user_code(self, cursor: clang.Cursor) -> bool:
        loc = cursor.location
        return loc.file is not None and os.path.abspath(loc.file.name) == self.source_path

    @staticmethod
    def _is_in_class_template(cursor: clang.Cursor) -> bool:
        """True when *cursor* sits inside a class-template definition (v1: skip).

        Mirrors ast_walker._is_in_class_template so template members get no
        scope entries either (the walker emits no points for them).
        """
        try:
            node = cursor.semantic_parent
            while node is not None:
                node_kind = _cursor_kind(node)
                if node_kind is not None and node_kind in (
                    clang.CursorKind.CLASS_TEMPLATE,
                    getattr(clang.CursorKind, "CLASS_TEMPLATE_PARTIAL_SPECIALIZATION", None),
                ):
                    return True
                node = node.semantic_parent
        except (AttributeError, TypeError, RuntimeError, ValueError):
            return False
        return False

    def _visit(self, cursor: clang.Cursor, scopes: dict[str, FunctionScope]) -> None:
        kind = _cursor_kind(cursor)
        if kind in _TEMPLATE_DEF_KINDS:
            return
        if (
            kind in (clang.CursorKind.FUNCTION_DECL, clang.CursorKind.CXX_METHOD)
            and cursor.is_definition()
        ):
            if not self._is_user_code(cursor):
                return
            if self._is_in_class_template(cursor):
                return
            fn = cursor.spelling
            scope = FunctionScope(func_name=fn)
            scopes[fn] = scope

            # Collect params as scope depth 0
            params: list[ScopeVar] = []
            for c in cursor.get_children():
                if c.kind == clang.CursorKind.PARM_DECL and c.spelling:
                    params.append(
                        ScopeVar(
                            name=c.spelling,
                            unique_id=c.spelling,
                            decl_line=c.location.line,
                            scope_depth=0,
                        )
                    )

            # Walk the body with a scope stack
            body = next(
                (c for c in cursor.get_children() if c.kind == clang.CursorKind.COMPOUND_STMT),
                None,
            )
            if body:
                self._walk_body(body, scope, list(params), depth=1)
            return

        for child in cursor.get_children():
            self._visit(child, scopes)

    @staticmethod
    def _merge_names(target: dict[int, list[ScopeVar]], line: int, visible: list[ScopeVar]) -> None:
        """Append-if-missing merge of `visible` into target[line] (first wins)."""
        if line <= 0:
            return
        entry = target.setdefault(line, [])
        existing_names = {v.name for v in entry}
        for v in visible:
            if v.name not in existing_names:
                entry.append(v)
                existing_names.add(v.name)

    @staticmethod
    def _merge_replace(
        target: dict[int, list[ScopeVar]], line: int, new_vars: list[ScopeVar]
    ) -> None:
        """Replace-by-name merge of `new_vars` into target[line].

        Same-line re-declarations shadow outer names, so the newest ScopeVar
        wins (records the inner decl_line/scope_depth).
        """
        if line <= 0:
            return
        entry = target.setdefault(line, [])
        by_name = {v.name: i for i, v in enumerate(entry)}
        for v in new_vars:
            if v.name in by_name:
                entry[by_name[v.name]] = v
            else:
                entry.append(v)

    def _record_pre(
        self,
        scope: FunctionScope,
        line: int,
        visible: list[ScopeVar],
    ) -> None:
        """Record the pre-declaration snapshot for a line (excludes own decls).

        First statement on the line wins: later same-line DECL_STMTs see
        earlier siblings, but that merged view must not leak back into the
        line's pre snapshot (`int a=1; int b=2;` → pre holds neither).
        """
        if line in scope.vars_at_line_pre:
            return
        self._merge_names(scope.vars_at_line_pre, line, visible)

    def _record_line(
        self,
        scope: FunctionScope,
        line: int,
        visible: list[ScopeVar],
    ) -> None:
        """Record `visible` into the main map and seed the post set."""
        self._merge_names(scope.vars_at_line, line, visible)
        self._merge_names(scope.vars_at_line_post, line, visible)

    def _add_post_decls(
        self,
        scope: FunctionScope,
        line: int,
        new_vars: list[ScopeVar],
    ) -> None:
        """Fold same-line declarations into the post set and the main map."""
        self._merge_replace(scope.vars_at_line_post, line, new_vars)
        self._merge_replace(scope.vars_at_line, line, new_vars)

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

            # Process all DECL_STMT regardless of file origin (template types
            # like vector<int> may report cursor location in STL headers).
            # For non-declaration statements, filter by user code as usual.
            if stmt_kind != clang.CursorKind.DECL_STMT and not self._is_user_code(stmt):
                continue

            # R1 (M2): post-declaration semantics — the pre snapshot is taken
            # first, then this line's DECL_STMT vars fold into `visible`
            # BEFORE recording, so declared names appear in their own line's
            # entry (incl. multi-decl `int lo = 0, hi = n`).
            if stmt_kind == clang.CursorKind.DECL_STMT:
                # Template-type decls (e.g. vector<int>) report the DECL_STMT
                # location in STL headers — record at the user-code VAR_DECL
                # line instead so the entry lands on the real source line.
                line = self._decl_line(stmt)
                try:
                    scope_end = cursor.extent.end.line
                except (AttributeError, ValueError):
                    scope_end = 0
                self._record_pre(scope, line, visible)
                new_vars = self._collect_decl_vars(
                    stmt, visible, depth, decl_line=line, extent_end=scope_end
                )
                self._record_line(scope, line, visible)
                self._add_post_decls(scope, line, new_vars)
                # Lambdas in initializers (`auto f = [...]{};`): body recurses like COMPOUND.
                by_name = {v.name: v for v in new_vars}
                for child in stmt.get_children():
                    lam_visible = visible
                    if (
                        child.kind == clang.CursorKind.VAR_DECL
                        and child.spelling in by_name
                        and self._subtree_has_callable(child)
                    ):
                        # The lambda body runs inside this var's own initializer
                        # (`auto` deduction still open): referencing it there is
                        # ill-formed, so hide it from the lambda's scope.
                        hidden = by_name[child.spelling]
                        lam_visible = [v for v in visible if v is not hidden]
                    self._walk_nested_lambda(child, scope, lam_visible, depth)
            else:
                line = stmt.location.line
                self._record_pre(scope, line, visible)
                self._record_line(scope, line, visible)

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

                elif stmt_kind in _TRY_CATCH_KINDS or (
                    _LAMBDA_KIND is not None and stmt_kind == _LAMBDA_KIND
                ):
                    self._walk_try(stmt, scope, visible, depth)

                elif stmt_kind == clang.CursorKind.SWITCH_STMT:
                    self._walk_switch(stmt, scope, visible, depth)

                elif stmt_kind in (
                    clang.CursorKind.CASE_STMT,
                    clang.CursorKind.DEFAULT_STMT,
                ):
                    self._walk_case(stmt, stmt_kind, scope, visible, depth)

    def _collect_decl_vars(
        self,
        decl_stmt: clang.Cursor,
        visible: list[ScopeVar],
        depth: int,
        decl_line: int | None = None,
        extent_end: int = 0,
    ) -> list[ScopeVar]:
        """Append VAR_DECL children of a DECL_STMT to `visible` (shadow-safe).

        Returns the newly added vars so callers can fold them into post sets.
        """
        new_vars: list[ScopeVar] = []
        for c in decl_stmt.get_children():
            if c.kind == clang.CursorKind.VAR_DECL and c.spelling:
                uid = c.spelling
                if any(v.name == c.spelling for v in visible):
                    uid = f"{c.spelling}_{depth}"
                sv = ScopeVar(
                    name=c.spelling,
                    unique_id=uid,
                    decl_line=decl_line if decl_line is not None else c.location.line,
                    scope_depth=depth,
                    extent_end=extent_end,
                )
                visible.append(sv)
                new_vars.append(sv)
            elif (
                (c.spelling.startswith("[") and c.spelling.endswith("]"))
                or (_DECOMP_KIND is not None and c.kind == _DECOMP_KIND)
            ):
                for sub in c.get_children():
                    if sub.kind.is_declaration() and sub.spelling and sub.spelling in c.spelling:
                        uid = sub.spelling
                        if any(v.name == sub.spelling for v in visible):
                            uid = f"{sub.spelling}_{depth}"
                        sub_line = (
                            sub.location.line
                            if (sub.location and sub.location.line > 0)
                            else (c.location.line if c.location else 0)
                        )
                        sv = ScopeVar(
                            name=sub.spelling,
                            unique_id=uid,
                            decl_line=decl_line if decl_line is not None else sub_line,
                            scope_depth=depth,
                            extent_end=extent_end,
                        )
                        visible.append(sv)
                        new_vars.append(sv)
        return new_vars

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
            elif (
                (c.spelling.startswith("[") and c.spelling.endswith("]"))
                or (_DECOMP_KIND is not None and c.kind == _DECOMP_KIND)
            ):
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
        loop_new: list[ScopeVar] = []
        header_line = stmt.location.line

        # Body is the last child; a lone statement is a braceless body (R3).
        children = list(stmt.get_children())
        body = children[-1] if children else None
        try:
            raw_end = body.extent.end.line if body is not None else 0
        except (AttributeError, ValueError):
            raw_end = 0
        loop_end = max(header_line, raw_end) if raw_end else 0

        # Capture init declarations (`for (int i = 0; ...)`) and the range-for
        # loop var (direct VAR_DECL child of CXX_FOR_RANGE_STMT).
        for child in children:
            if child.kind == clang.CursorKind.DECL_STMT:
                loop_new.extend(
                    self._collect_decl_vars(
                        child,
                        loop_visible,
                        depth,
                        decl_line=header_line,
                        extent_end=loop_end,
                    )
                )
            elif child.kind == clang.CursorKind.VAR_DECL and child.spelling:
                uid = child.spelling
                if any(v.name == child.spelling for v in loop_visible):
                    uid = f"{child.spelling}_{depth}"
                sv = ScopeVar(
                    name=child.spelling,
                    unique_id=uid,
                    decl_line=header_line,
                    scope_depth=depth,
                    extent_end=loop_end,
                )
                loop_visible.append(sv)
                loop_new.append(sv)
            elif (
                (child.spelling.startswith("[") and child.spelling.endswith("]"))
                or (_DECOMP_KIND is not None and child.kind == _DECOMP_KIND)
            ):
                for sub in child.get_children():
                    if sub.kind.is_declaration() and sub.spelling and sub.spelling in child.spelling:
                        uid = sub.spelling
                        if any(v.name == sub.spelling for v in loop_visible):
                            uid = f"{sub.spelling}_{depth}"
                        sv = ScopeVar(
                            name=sub.spelling,
                            unique_id=uid,
                            decl_line=header_line,
                            scope_depth=depth,
                            extent_end=loop_end,
                        )
                        loop_visible.append(sv)
                        loop_new.append(sv)

        # The loop header line carries the loop vars (replace-by-name so a
        # loop var shadows an outer same-named var); outer visible is untouched.
        self._add_post_decls(scope, header_line, loop_new)

        if body is None:
            return
        self._record_loop_range(scope, stmt, body, loop_new)
        if _cursor_kind(body) == clang.CursorKind.COMPOUND_STMT:
            self._walk_body(body, scope, loop_visible, depth + 1)
        else:
            self._walk_braceless_body(body, scope, loop_visible, depth + 1)

    def _record_loop_range(
        self,
        scope: FunctionScope,
        stmt: clang.Cursor,
        body: clang.Cursor,
        loop_new: list[ScopeVar],
    ) -> None:
        header_line = stmt.location.line
        try:
            body_end = body.extent.end.line
        except (AttributeError, ValueError):
            return
        if not loop_new or header_line <= 0 or not body_end:
            return
        end = max(header_line, body_end)
        for v in loop_new:
            scope.loop_var_ranges.setdefault(v.name, []).append((header_line, end))

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

    def _walk_nested_lambda(
        self,
        node: clang.Cursor,
        scope: FunctionScope,
        visible: list[ScopeVar],
        depth: int,
    ) -> None:
        for child in node.get_children():
            ck = _cursor_kind(child)
            if ck in _TRY_CATCH_KINDS or (_LAMBDA_KIND is not None and ck == _LAMBDA_KIND):
                self._walk_try(child, scope, visible, depth)

    @staticmethod
    def _subtree_has_callable(node: clang.Cursor) -> bool:
        for child in node.get_children():
            ck = _cursor_kind(child)
            if ck in _TRY_CATCH_KINDS or (_LAMBDA_KIND is not None and ck == _LAMBDA_KIND):
                return True
            if ScopeTracker._subtree_has_callable(child):
                return True
        return False

    def _walk_try(
        self,
        stmt: clang.Cursor,
        scope: FunctionScope,
        visible: list[ScopeVar],
        depth: int,
    ) -> None:
        for child in stmt.get_children():
            ck = _cursor_kind(child)
            if ck == clang.CursorKind.COMPOUND_STMT:
                self._walk_body(child, scope, visible, depth + 1)
            elif ck in _TRY_CATCH_KINDS or (_LAMBDA_KIND is not None and ck == _LAMBDA_KIND):
                self._walk_try(child, scope, visible, depth)

    def _walk_switch(
        self,
        stmt: clang.Cursor,
        scope: FunctionScope,
        visible: list[ScopeVar],
        depth: int,
    ) -> None:
        for child in stmt.get_children():
            if _cursor_kind(child) == clang.CursorKind.COMPOUND_STMT:
                self._walk_body(child, scope, visible, depth + 1)
                return

    def _walk_case(
        self,
        stmt: clang.Cursor,
        stmt_kind: clang.CursorKind,
        scope: FunctionScope,
        visible: list[ScopeVar],
        depth: int,
    ) -> None:
        children = list(stmt.get_children())
        bodies = children[1:] if stmt_kind == clang.CursorKind.CASE_STMT else children
        for node in bodies:
            if _cursor_kind(node) == clang.CursorKind.COMPOUND_STMT:
                self._walk_body(node, scope, visible, depth + 1)
            elif _cursor_kind(node) == clang.CursorKind.DECL_STMT:
                line = self._decl_line(node)
                try:
                    scope_end = stmt.extent.end.line
                except (AttributeError, ValueError):
                    scope_end = 0
                self._record_pre(scope, line, visible)
                new_vars = self._collect_decl_vars(
                    node, visible, depth + 1, decl_line=line, extent_end=scope_end
                )
                self._record_line(scope, line, visible)
                self._add_post_decls(scope, line, new_vars)
            else:
                self._walk_braceless_body(node, scope, visible, depth + 1)

    def _walk_braceless_body(
        self,
        node: clang.Cursor,
        scope: FunctionScope,
        visible: list[ScopeVar],
        depth: int,
    ) -> None:
        """Record scope for a single-statement body; recurse if nested control."""
        if self._is_user_code(node) and node.location.line:
            self._record_pre(scope, node.location.line, visible)
            self._record_line(scope, node.location.line, visible)
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
        elif kind in _TRY_CATCH_KINDS or (_LAMBDA_KIND is not None and kind == _LAMBDA_KIND):
            self._walk_try(node, scope, visible, depth)
        elif kind == clang.CursorKind.SWITCH_STMT:
            self._walk_switch(node, scope, visible, depth)
        elif kind in (
            clang.CursorKind.CASE_STMT,
            clang.CursorKind.DEFAULT_STMT,
        ):
            self._walk_case(node, kind, scope, visible, depth)
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
