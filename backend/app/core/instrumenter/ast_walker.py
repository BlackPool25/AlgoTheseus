"""
ast_walker.py — libclang AST traversal to collect injection points.

Walks the AST of a user's C++ source file and produces a list of InjectionPoint
objects — each describing where a trace call should be inserted and what kind.

Rules (from new_plan.md §5.1):
- Only inject into user-defined functions (cursor.location.file == source_path).
- Skip template function instantiations (v1 scope).
- Skip macro-expanded nodes (inconsistent line numbers).
- Skip STL method bodies (inject STATE after the call returns instead).
- Loop counters are collected separately so the injector can declare them
  at function start, not inside the loop.

Gotcha: libclang's Python bindings use clang.cindex. The library path must
be set before import if libclang is not on the system path. We handle this
by trying the installed libclang package's bundled .so.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from enum import Enum, auto

import clang.cindex as clang

# ── libclang setup ────────────────────────────────────────────────────────────
# The libclang Python package bundles its own .so. Point the bindings at it.
# Toolchain pin lives in _libclang_compat (bundled clang/native/libclang.so +
# registration of cursor kinds missing from the wheel's cindex.py, e.g. 437).
from app.core.instrumenter import _libclang_compat
from app.core.instrumenter.diagnostics import collect_diagnostics, parse_with_diagnostics

# Re-exported: resolves the bundled clang/native/libclang.so (never system lib).
_find_libclang = _libclang_compat._find_libclang

_lib = _libclang_compat.ensure_libclang()


# ── Data types ────────────────────────────────────────────────────────────────

def _cursor_kind(cursor: clang.Cursor) -> clang.CursorKind | None:
    """Return cursor.kind, or None if libclang reports an unknown kind id.

    Newer system headers can expose cursor kinds newer than these bindings
    (e.g. GCC 16 headers with libclang 18 bindings raise ValueError).
    Unknown kinds are never user statements of interest — treat as absent.
    """
    try:
        return cursor.kind
    except ValueError:
        return None

class InjectKind(Enum):
    FUNC_ENTER  = auto()   # start of a user function body
    FUNC_EXIT   = auto()   # before a return statement
    STATE       = auto()   # after a statement (captures in-scope vars)
    BRANCH      = auto()   # before an if/else-if condition
    LOOP_ITER   = auto()   # at the top of a loop body
    LOOP_COUNTER = auto()  # declaration of __loop_iter_N at function start


# R2 (M3): range-for is a distinct cursor kind, not FOR_STMT. getattr guard so
# older bindings without it fall back gracefully (excluded from _LOOP_KINDS).
_RANGE_FOR_KIND: clang.CursorKind | None = getattr(
    clang.CursorKind, "CXX_FOR_RANGE_STMT", None
)
_LOOP_KINDS: tuple = tuple(
    k
    for k in (
        clang.CursorKind.FOR_STMT,
        clang.CursorKind.WHILE_STMT,
        clang.CursorKind.DO_STMT,
        _RANGE_FOR_KIND,
    )
    if k is not None
)


# Wave 2b: guarded token fallback for UNEXPOSED/macro nodes. get_tokens can
# raise on cursors with degenerate extents — never let it escape the walker.
_UNEXPOSED_KINDS: tuple = tuple(
    k
    for k in (
        getattr(clang.CursorKind, "UNEXPOSED_DECL", None),
        getattr(clang.CursorKind, "UNEXPOSED_EXPR", None),
        getattr(clang.CursorKind, "UNEXPOSED_STMT", None),
    )
    if k is not None
)

# Class-template definition kinds (getattr-guarded like _RANGE_FOR_KIND).
_CLASS_TEMPLATE_KINDS: tuple = tuple(
    k
    for k in (
        getattr(clang.CursorKind, "CLASS_TEMPLATE", None),
        getattr(clang.CursorKind, "CLASS_TEMPLATE_PARTIAL_SPECIALIZATION", None),
    )
    if k is not None
)

# Function-template definitions (v1: skip-with-reason, same as class templates).
_FUNCTION_TEMPLATE_KINDS: tuple = tuple(
    k
    for k in (getattr(clang.CursorKind, "FUNCTION_TEMPLATE", None),)
    if k is not None
)

# Try/catch + lambda kinds (getattr-guarded; bodies recurse like COMPOUND).
_TRY_CATCH_KINDS: tuple = tuple(
    k
    for k in (
        getattr(clang.CursorKind, "CXX_TRY_STMT", None),
        getattr(clang.CursorKind, "CXX_CATCH_STMT", None),
    )
    if k is not None
)
_LAMBDA_KIND: clang.CursorKind | None = getattr(
    clang.CursorKind, "LAMBDA_EXPR", None
)


def _safe_get_tokens(cursor: clang.Cursor) -> list[str]:
    """Guarded get_tokens wrapper: token spellings, [] on any libclang failure.

    Never raises — callers use this where cursor kind is None/UNEXPOSED and
    cursor.extent/location cannot be trusted.
    """
    try:
        return [t.spelling for t in cursor.get_tokens()]
    except (AttributeError, TypeError, RuntimeError, ValueError, AssertionError):
        return []


def _fallback_user_lines(cursor: clang.Cursor, source_path: str) -> tuple[int, int] | None:
    """Re-lex a kind-None/UNEXPOSED cursor's user-file line range from tokens.

    Returns (first_line, last_line) only when token locations resolve inside
    the user file with sane lines. Returns None (skip-with-reason — the
    caller must not splice) when tokens fail, no user-file tokens exist, or
    the cursor is macro-expanded (location.offset == 0 with a nonzero
    extent, mirroring ASTWalker._is_macro_expanded).
    """
    try:
        toks = list(cursor.get_tokens())
    except (AttributeError, TypeError, RuntimeError, ValueError, AssertionError):
        return None
    try:
        lines = [
            t.location.line
            for t in toks
            if t.location.file is not None
            and t.location.line > 0
            and os.path.abspath(t.location.file.name) == source_path
        ]
    except (AttributeError, TypeError, RuntimeError, ValueError, OSError):
        return None
    if not lines:
        return None
    try:
        macro = (
            cursor.location.file is not None
            and cursor.extent.start.offset != cursor.extent.end.offset
            and cursor.location.offset == 0
        )
    except (AttributeError, TypeError, RuntimeError, ValueError):
        return None
    if macro:
        return None
    first, last = min(lines), max(lines)
    if first <= 0 or last < first or last - first > 1000:
        return None
    return (first, last)


def _is_in_class_template(cursor: clang.Cursor) -> bool:
    """True when *cursor* sits inside a class-template definition (v1: skip).

    Members of a class template surface as ordinary CXX_METHOD cursors in
    user code — without this guard the walker splices TRACE into the
    template body (instantiated per specialization: bogus splice).
    """
    try:
        node = cursor.semantic_parent
        while node is not None:
            if _cursor_kind(node) in _CLASS_TEMPLATE_KINDS:
                return True
            node = node.semantic_parent
    except (AttributeError, TypeError, RuntimeError, ValueError):
        return False
    return False


@dataclass
class InjectionPoint:
    """A single location where a trace call will be inserted."""
    kind: InjectKind
    line: int           # 1-based source line
    col: int            # 1-based source column (for precise insertion)
    func_name: str      # enclosing function name
    depth: int          # call depth (0 = main, 1 = called from main, etc.)
    # For FUNC_ENTER: parameter names in scope
    param_names: list[str] = field(default_factory=list)
    # For STATE: variable names in scope at this point
    var_names: list[str] = field(default_factory=list)
    # For BRANCH: the condition text
    condition_text: str = ""
    # For BRANCH: free variable names referenced by the condition (T8 ops).
    # Collected from DECL_REF_EXPR spellings only (never MEMBER_REF — a bare
    # member name is not evaluable at the injection site). Capped at 8 names
    # so the emitted __TRACE_BRANCH_OPS call stays bounded. Empty for switch
    # labels (the runtime expr is `true /* ... */`, not user vars).
    cond_vars: list[str] = field(default_factory=list)
    # For LOOP_ITER / LOOP_COUNTER: unique counter variable name
    counter_var: str = ""


@dataclass
class WalkResult:
    """Output of ast_walker.walk()."""
    injection_points: list[InjectionPoint]
    # Maps function name → list of loop counter variable names needed
    loop_counters: dict[str, list[str]]
    # Top-level TU variable names (user globals, decl order); injector feeds
    # these to every STATE for the v2 `g` snapshot with change-dedup.
    global_vars: list[str] = field(default_factory=list)
    diagnostics: list[str] = field(default_factory=list)


# ── Walker ────────────────────────────────────────────────────────────────────

class ASTWalker:
    """Walks a C++ AST and collects injection points.

    Args:
        source_path: Absolute path to the user's .cpp file.
        extra_args: Additional compiler flags (e.g., ["-std=c++17"]).
    """

    def __init__(self, source_path: str, extra_args: list[str] | None = None):
        self.source_path = os.path.abspath(source_path)
        # W0.1 pin: shared default carries -isystem <gcc-include> so STL
        # headers parse (libclang 18 vs GCC 16 gap). Explicit args bypass it.
        self.extra_args = extra_args if extra_args is not None else _libclang_compat.default_extra_args()
        self._index = clang.Index.create()
        self._loop_counter_seq = 0

    def walk(self) -> WalkResult:
        """Parse the source and return all injection points.

        Returns:
            WalkResult with injection_points and loop_counters.
        """
        tu = parse_with_diagnostics(self._index, self.source_path, self.extra_args)
        diagnostics = collect_diagnostics(tu)

        points: list[InjectionPoint] = []
        loop_counters: dict[str, list[str]] = {}

        # Top-level TU declarations: user globals for the v2 STATE snapshot.
        global_vars: list[str] = []
        for child in tu.cursor.get_children():
            if (
                child.kind == clang.CursorKind.VAR_DECL
                and child.spelling
                and self._is_user_code(child)
                and not child.spelling.startswith("__")
                and child.spelling not in global_vars
            ):
                global_vars.append(child.spelling)

        # First pass: collect all user-defined function names for depth tracking
        user_functions: set[str] = set()
        self._collect_user_functions(tu.cursor, user_functions)

        # Second pass: walk with depth tracking
        # depth_map: function_name → call depth (0 = top-level, 1 = called from top-level, etc.)
        # We compute depth by BFS from main/entry points
        depth_map = self._compute_call_depths(tu.cursor, user_functions)

        self._walk_cursor(tu.cursor, points, loop_counters, depth=0, func_name="", func_depth=0, depth_map=depth_map)

        return WalkResult(
            injection_points=points,
            loop_counters=loop_counters,
            global_vars=global_vars,
            diagnostics=diagnostics,
        )

    def _collect_user_functions(self, cursor: clang.Cursor, result: set[str]) -> None:
        """Collect names of all user-defined functions."""
        if _cursor_kind(cursor) in (clang.CursorKind.FUNCTION_DECL, clang.CursorKind.CXX_METHOD) and cursor.is_definition():
            if self._is_user_code(cursor):
                result.add(cursor.spelling)
        for child in cursor.get_children():
            self._collect_user_functions(child, result)

    def _compute_call_depths(self, root: clang.Cursor, user_functions: set[str]) -> dict[str, int]:
        """Compute call depth for each user function.

        Uses BFS from main() (depth 0). Functions not reachable from main
        get depth 0 as well (they may be called from multiple places).
        """
        # Build call graph: caller → set of callees
        call_graph: dict[str, set[str]] = {fn: set() for fn in user_functions}
        self._build_call_graph(root, call_graph, user_functions, current_func="")

        # BFS from main
        depth_map: dict[str, int] = {}
        start = "main" if "main" in user_functions else (next(iter(user_functions)) if user_functions else None)
        if start is None:
            return depth_map

        from collections import deque
        queue: deque[tuple[str, int]] = deque([(start, 0)])
        visited: set[str] = set()

        while queue:
            fn, d = queue.popleft()
            if fn in visited:
                continue
            visited.add(fn)
            depth_map[fn] = d
            for callee in call_graph.get(fn, set()):
                if callee not in visited:
                    queue.append((callee, d + 1))

        # Assign depth 0 to any unreachable functions
        for fn in user_functions:
            if fn not in depth_map:
                depth_map[fn] = 0

        return depth_map

    def _build_call_graph(
        self,
        cursor: clang.Cursor,
        call_graph: dict[str, set[str]],
        user_functions: set[str],
        current_func: str,
    ) -> None:
        """Recursively build the call graph."""
        kind = _cursor_kind(cursor)
        if kind in (clang.CursorKind.FUNCTION_DECL, clang.CursorKind.CXX_METHOD) and cursor.is_definition():
            if self._is_user_code(cursor):
                current_func = cursor.spelling
        elif kind == clang.CursorKind.CALL_EXPR:
            callee = cursor.spelling or self._get_call_expr_name(cursor)
            if current_func and callee in user_functions:
                call_graph.setdefault(current_func, set()).add(callee)

        for child in cursor.get_children():
            self._build_call_graph(child, call_graph, user_functions, current_func)

    # ── Internal traversal ────────────────────────────────────────────────────

    def _is_user_code(self, cursor: clang.Cursor) -> bool:
        """True if this cursor is in the user's source file (not a header)."""
        loc = cursor.location
        return (
            loc.file is not None
            and os.path.abspath(loc.file.name) == self.source_path
        )

    def _is_macro_expanded(self, cursor: clang.Cursor) -> bool:
        """True if this cursor was produced by a macro expansion."""
        return cursor.location.file is not None and cursor.extent.start.offset != cursor.extent.end.offset and cursor.location.offset == 0

    def _is_template_instantiation(self, cursor: clang.Cursor) -> bool:
        """True if this is a template instantiation (skip in v1)."""
        return cursor.kind in (
            clang.CursorKind.FUNCTION_TEMPLATE,
            clang.CursorKind.CLASS_TEMPLATE,
        )

    def _get_condition_text(self, cursor: clang.Cursor) -> str:
        """Extract the text of a condition expression from the source."""
        try:
            start = cursor.extent.start
            end = cursor.extent.end
            with open(self.source_path, encoding="utf-8") as f:
                lines = f.readlines()
            # Single-line condition
            if start.line == end.line:
                line = lines[start.line - 1]
                text = line[start.column - 1 : end.column - 1].strip()
            else:
                # Multi-line condition (e.g. `if (a &&\n  b)`): slice
                # first/last lines by column, take middle lines whole,
                # then collapse all whitespace to single spaces so the
                # result is a valid single-line C++ expression.
                parts: list[str] = []
                parts.append(lines[start.line - 1][start.column - 1 :].rstrip("\n"))
                for lineno in range(start.line + 1, end.line):
                    parts.append(lines[lineno - 1].rstrip("\n"))
                parts.append(lines[end.line - 1][: end.column - 1])
                text = " ".join(" ".join(parts).split())
            # Guard against empty or degenerate extraction — never return
            # a placeholder that isn't valid C++ (it gets spliced into
            # __TRACE_BRANCH as the evaluated expression).
            if not text or text == "?":
                return "true"
            return text
        except Exception:
            return "true"

    def _get_condition_vars(self, cond: clang.Cursor) -> list[str]:
        """Free variable names referenced by a branch condition (T8 ops)."""
        names: list[str] = []
        seen: set[str] = set()
        try:
            self._collect_refs(cond, names, seen)
        except (AttributeError, TypeError, RuntimeError, ValueError):
            return []
        return names[:8]

    def _collect_refs(
        self, cursor: clang.Cursor, names: list[str], seen: set[str]
    ) -> None:
        if cursor.kind == clang.CursorKind.DECL_REF_EXPR and cursor.spelling:
            name = cursor.spelling
            # W0.1: with STL headers fully parsed, overloaded operators
            # (e.g. vector::operator[]) resolve to DECL_REF_EXPRs naming a
            # CXX_METHOD; a bare `operator[]` is not evaluable at the
            # injection site, so skip overload names (a user variable can
            # never be spelled `operator<symbol>` — `operatorx` stays valid).
            if name and not name.startswith("__") and not re.fullmatch(r"operator([^A-Za-z0-9_].*)?", name) and name not in seen:
                ref = cursor.referenced
                if ref is None or "FUNCTION" not in str(ref.kind):
                    seen.add(name)
                    names.append(name)
        for child in cursor.get_children():
            self._collect_refs(child, names, seen)

    def _get_return_expr_text(self, return_cursor: clang.Cursor) -> str:
        """Extract the return expression text from a RETURN_STMT cursor.

        Returns empty string for void returns.
        """
        try:
            children = list(return_cursor.get_children())
            if not children:
                return ""  # void return
            expr = children[0]
            start = expr.extent.start
            end = expr.extent.end
            with open(self.source_path, encoding="utf-8") as f:
                lines = f.readlines()
            if start.line == end.line:
                line = lines[start.line - 1]
                text = line[start.column - 1 : end.column - 1].strip()
                if len(text) < 200 and "\n" not in text:
                    return text
            return ""
        except (OSError, ValueError, AttributeError, IndexError, TypeError):
            return ""

    def _get_call_expr_name(self, cursor: clang.Cursor) -> str:
        """Best-effort callee name for C++ call expressions (incl. member calls)."""
        for child in cursor.get_children():
            if child.kind in (clang.CursorKind.MEMBER_REF_EXPR, clang.CursorKind.DECL_REF_EXPR) and child.spelling:
                return child.spelling
        return ""

    def _is_safe_return_expr(self, text: str) -> bool:
        """Return True only for simple, side-effect-free return expressions."""
        if "(" in text or ")" in text or "?" in text or ":" in text or "," in text:
            return False
        if re.fullmatch(r"-?\d+(\.\d+)?", text):
            return True
        return re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*(\[[^\]]+\])*") is not None

    def _walk_cursor(
        self,
        cursor: clang.Cursor,
        points: list[InjectionPoint],
        loop_counters: dict[str, list[str]],
        depth: int,
        func_name: str,
        func_depth: int,
        depth_map: dict[str, int] | None = None,
    ) -> None:
        """Recursively walk the AST."""
        kind = _cursor_kind(cursor)
        if kind is None:
            # Transparent container — may still hold nodes of interest below.
            for child in cursor.get_children():
                self._walk_cursor(child, points, loop_counters, depth, func_name, func_depth, depth_map)
            return

        # v1 scope: never splice inside template definitions (per-specialization bogus splice).
        if kind in _CLASS_TEMPLATE_KINDS or kind in _FUNCTION_TEMPLATE_KINDS:
            return

        # ── Function definition ───────────────────────────────────────────────
        if kind in (clang.CursorKind.FUNCTION_DECL, clang.CursorKind.CXX_METHOD) and cursor.is_definition():
            if not self._is_user_code(cursor):
                return
            if self._is_template_instantiation(cursor):
                return
            if _is_in_class_template(cursor):
                return

            fn = cursor.spelling
            # Use precomputed depth from call graph analysis
            fn_depth = (depth_map or {}).get(fn, 0)

            # Collect parameter names
            params = [
                c.spelling
                for c in cursor.get_children()
                if c.kind == clang.CursorKind.PARM_DECL
            ]

            # Find the compound statement (function body)
            body = next(
                (c for c in cursor.get_children()
                 if c.kind == clang.CursorKind.COMPOUND_STMT),
                None,
            )
            if body is None:
                return

            # FUNC_ENTER at the opening brace
            points.append(InjectionPoint(
                kind=InjectKind.FUNC_ENTER,
                line=body.extent.start.line,
                col=body.extent.start.column + 1,  # after the {
                func_name=fn,
                depth=fn_depth,
                param_names=params,
            ))

            loop_counters.setdefault(fn, [])

            # Walk the body — inject STATE at the start of each unique source line
            seen_lines: set[int] = set()
            for child in body.get_children():
                line = child.location.line
                if line not in seen_lines and line > 0:
                    seen_lines.add(line)
                    points.append(InjectionPoint(
                        kind=InjectKind.STATE,
                        line=line,
                        col=1,
                        func_name=fn,
                        depth=fn_depth,
                    ))
                self._walk_stmt(child, points, loop_counters, fn, fn_depth, seen_lines)

            return  # Don't recurse further — _walk_stmt handles the body

        # ── Recurse into non-function nodes ──────────────────────────────────
        for child in cursor.get_children():
            self._walk_cursor(child, points, loop_counters, depth, func_name, func_depth, depth_map)

    def _maybe_emit_state(
        self,
        cursor: clang.Cursor,
        points: list[InjectionPoint],
        func_name: str,
        func_depth: int,
        seen: set[int],
        var_names: list[str] | None = None,
    ) -> None:
        """Emit one STATE point for *cursor*'s line if not already covered.

        Gotcha: _walk_cursor only emits STATE for direct function-body
        children, so statements nested inside for/while/do/if bodies (e.g.
        ``pal[i][j] = true``) never got __TRACE_STATE events and loop vars
        (i, j) vanished from the VARIABLES panel — __TRACE_LOOP_ITER
        carries only the iteration counter, not in-scope vars. Every
        non-compound statement routed through _walk_stmt must pass through
        here; the injector resolves actual var names via
        scope.vars_at_line. Dedup is per unique line (shared *seen* set),
        user-code only, one STATE per line.
        """
        line = cursor.location.line
        if line <= 0 or line in seen:
            return
        seen.add(line)
        points.append(InjectionPoint(
            kind=InjectKind.STATE,
            line=line,
            col=1,
            func_name=func_name,
            depth=func_depth,
            var_names=list(var_names or []),
        ))

    @staticmethod
    def _loop_body_is_braced(cursor: clang.Cursor, kind: clang.CursorKind) -> bool:
        """True when a loop statement's body is a braced compound statement.

        S8: header STATE is safe only for braced loops (placement lands
        inside the body, loop var in scope). Braceless single-statement
        bodies must skip header STATE — any splice between header and body
        detaches the body, and post-body placement leaves the header var
        dead. Body is children[-1] for for/while/range-for, children[0]
        for do.
        """
        try:
            children = list(cursor.get_children())
        except (AttributeError, TypeError, RuntimeError):
            return False
        if not children:
            return False
        body = children[0] if kind == clang.CursorKind.DO_STMT else children[-1]
        return _cursor_kind(body) == clang.CursorKind.COMPOUND_STMT

    def _walk_stmt(
        self,
        cursor: clang.Cursor,
        points: list[InjectionPoint],
        loop_counters: dict[str, list[str]],
        func_name: str,
        func_depth: int,
        seen: set[int] | None = None,
    ) -> None:
        """Walk a statement node inside a function body."""
        kind = _cursor_kind(cursor)
        if kind is None:
            # Wave 2b fallback: unknown kind — re-lex user lines from tokens.
            # Splice one STATE only if they resolve, else skip-with-reason.
            if seen is None:
                seen = set()
            resolved = _fallback_user_lines(cursor, self.source_path)
            if resolved is None:
                return
            if resolved[0] not in seen and resolved[0] > 0:
                seen.add(resolved[0])
                points.append(InjectionPoint(
                    kind=InjectKind.STATE,
                    line=resolved[0],
                    col=1,
                    func_name=func_name,
                    depth=func_depth,
                ))
            return
        # Allow all DECL_STMT even if the cursor location is in a system header,
        # which commonly happens with template variable declarations like
        # vector<int> arr(m) due to libclang resolving the template location.
        if kind != clang.CursorKind.DECL_STMT and not self._is_user_code(cursor):
            return
        # Never inject inside macro expansions (unreliable line numbers) or
        # STL bodies (not user code — guarded above). Injected code needs no
        # guard: the walk runs on pristine source before the injector edits it.
        if self._is_macro_expanded(cursor):
            return
        if seen is None:
            seen = set()
        if kind in _UNEXPOSED_KINDS and (
            cursor.location.file is None or cursor.location.line <= 0
        ):
            # Wave 2b fallback: UNEXPOSED node with an unusable location —
            # re-lex user lines from tokens; skip unless they resolve.
            resolved = _fallback_user_lines(cursor, self.source_path)
            if resolved is None:
                return
            if resolved[0] not in seen and resolved[0] > 0:
                seen.add(resolved[0])
                points.append(InjectionPoint(
                    kind=InjectKind.STATE,
                    line=resolved[0],
                    col=1,
                    func_name=func_name,
                    depth=func_depth,
                ))
            return

        # STATE for this statement's own line (one per unique line).
        # Compound statements carry no state of their own — their children
        # emit via recursion below. S8: loop headers emit STATE only when
        # braced (body is COMPOUND_STMT) — placement lands inside the body
        # with the loop var in scope. Braceless loop headers skip here; the
        # single-statement body still emits its own STATE via the loop
        # handler below. All other kinds (DECL_STMT, assignments,
        # call/operator exprs, IF headers, RETURN) get a STATE point here;
        # existing handlers below add their BRANCH / LOOP_ITER / FUNC_EXIT
        # points on top. The injector skips STATE on `return` lines and
        # before `else`, matching top-level behaviour.
        if kind != clang.CursorKind.COMPOUND_STMT and (
            kind not in _LOOP_KINDS or self._loop_body_is_braced(cursor, kind)
        ):
            # A declaration names its own vars so the injector's scope merge
            # captures them even where the scope map has no entry yet.
            decl_names: list[str] = []
            if kind == clang.CursorKind.DECL_STMT:
                decl_names = [
                    c.spelling for c in cursor.get_children()
                    if c.kind == clang.CursorKind.VAR_DECL and c.spelling
                ]
            self._maybe_emit_state(cursor, points, func_name, func_depth, seen, decl_names)

        # ── Return statement → FUNC_EXIT ──────────────────────────────────────
        if kind == clang.CursorKind.RETURN_STMT:
            # Extract the return expression text for __TRACE_FUNC_EXIT
            ret_expr = self._get_return_expr_text(cursor)
            points.append(InjectionPoint(
                kind=InjectKind.FUNC_EXIT,
                line=cursor.location.line,
                col=cursor.location.column,
                func_name=func_name,
                depth=func_depth,
                condition_text=ret_expr,  # reuse field to carry return expr
            ))
            return

        # ── If statement → BRANCH ─────────────────────────────────────────────
        if kind == clang.CursorKind.IF_STMT:
            children = list(cursor.get_children())
            if children:
                cond = children[0]
                cond_text = self._get_condition_text(cond)
                # Skip branch tracing for input-consuming conditions
                if any(tok in cond_text for tok in ("cin", "scanf", "getline")):
                    # Recurse into then/else bodies without adding BRANCH
                    if len(children) > 1:
                        self._walk_stmt(children[1], points, loop_counters, func_name, func_depth, seen)
                    if len(children) > 2:
                        else_branch = children[2]
                        if else_branch.kind == clang.CursorKind.IF_STMT:
                            else_children = list(else_branch.get_children())
                            for ec in else_children[1:]:
                                self._walk_stmt(ec, points, loop_counters, func_name, func_depth, seen)
                        else:
                            self._walk_stmt(else_branch, points, loop_counters, func_name, func_depth, seen)
                    return
                # Inject BRANCH for this if only.
                # We do NOT inject for else-if — that would insert a statement
                # between `if` and `else`, breaking the chain.
                points.append(InjectionPoint(
                    kind=InjectKind.BRANCH,
                    line=cursor.location.line,
                    col=cursor.location.column,
                    func_name=func_name,
                    depth=func_depth,
                    condition_text=cond_text,
                    cond_vars=self._get_condition_vars(cond),
                ))
            # Recurse into then-body (children[1])
            if len(children) > 1:
                self._walk_stmt(children[1], points, loop_counters, func_name, func_depth, seen)
            # Recurse into else branch — but if it's another IF_STMT (else-if),
            # recurse into its bodies without injecting another BRANCH at the top.
            if len(children) > 2:
                else_branch = children[2]
                if else_branch.kind == clang.CursorKind.IF_STMT:
                    # else-if: recurse into its then/else bodies only
                    else_children = list(else_branch.get_children())
                    for ec in else_children[1:]:
                        self._walk_stmt(ec, points, loop_counters, func_name, func_depth, seen)
                else:
                    self._walk_stmt(else_branch, points, loop_counters, func_name, func_depth, seen)
            return

        # ── Switch statement → BRANCH per case ──────────────────────────────────
        if kind == clang.CursorKind.SWITCH_STMT:
            children = list(cursor.get_children())
            if not children:
                return

            # First child is the switch condition expression
            cond = children[0]
            cond_text = self._get_condition_text(cond)

            # Find the compound statement (the switch body)
            body = None
            for c in children:
                if c.kind == clang.CursorKind.COMPOUND_STMT:
                    body = c
                    break
            if body is None:
                return

            # Walk body children: CASE_STMT / DEFAULT_STMT → BRANCH + recurse
            for child in body.get_children():
                if child.kind == clang.CursorKind.CASE_STMT:
                    case_children = list(child.get_children())
                    if not case_children:
                        continue
                    # First child is the case-value expression
                    case_value = case_children[0]
                    case_value_text = self._get_condition_text(case_value)

                    # Condition text uses a C block comment so the runtime
                    # expression evaluates to `true` while the JSON label
                    # carries a human-readable description.
                    label = f"true /* switch({cond_text}) == case {case_value_text} */"

                    # Inject BRANCH at the first body statement (after the case
                    # label) — case labels are jump targets, so code placed
                    # *before* a label is never reached.
                    body_stmts = case_children[1:]
                    if body_stmts:
                        inject_line = body_stmts[0].extent.start.line
                    else:
                        inject_line = child.extent.start.line

                    points.append(InjectionPoint(
                        kind=InjectKind.BRANCH,
                        line=inject_line,
                        col=1,
                        func_name=func_name,
                        depth=func_depth,
                        condition_text=label,
                    ))

                    for stmt in body_stmts:
                        self._walk_stmt(stmt, points, loop_counters, func_name, func_depth, seen)

                elif child.kind == clang.CursorKind.DEFAULT_STMT:
                    label = f"true /* switch({cond_text}) == default */"

                    body_stmts = list(child.get_children())
                    if body_stmts:
                        inject_line = body_stmts[0].extent.start.line
                    else:
                        inject_line = child.extent.start.line

                    points.append(InjectionPoint(
                        kind=InjectKind.BRANCH,
                        line=inject_line,
                        col=1,
                        func_name=func_name,
                        depth=func_depth,
                        condition_text=label,
                    ))

                    for stmt in body_stmts:
                        self._walk_stmt(stmt, points, loop_counters, func_name, func_depth, seen)

                else:
                    # Non-case statement inside switch body (declaration, etc.)
                    self._walk_stmt(child, points, loop_counters, func_name, func_depth, seen)

            return

        # ── Loop statements → LOOP_ITER ───────────────────────────────────────
        # R2 (M3): CXX_FOR_RANGE_STMT handled first-class (header STATE emitted
        # above, LOOP_ITER + body recursion below); range body is the last
        # child, same as FOR/WHILE.
        if kind in _LOOP_KINDS:
            counter_var = f"__loop_iter_{self._loop_counter_seq}"
            self._loop_counter_seq += 1
            loop_counters.setdefault(func_name, []).append(counter_var)

            # Loop body is children[0] for do, children[-1] otherwise (braceless parity).
            children = list(cursor.get_children())
            if not children:
                body = None
            elif kind == clang.CursorKind.DO_STMT:
                body = children[0]
            else:
                body = children[-1]

            if body and body.kind == clang.CursorKind.COMPOUND_STMT:
                # Inject LOOP_ITER at the start of the body
                points.append(InjectionPoint(
                    kind=InjectKind.LOOP_ITER,
                    line=body.extent.start.line,
                    col=body.extent.start.column + 1,
                    func_name=func_name,
                    depth=func_depth,
                    counter_var=counter_var,
                ))
                # Recurse into body statements
                for child in body.get_children():
                    self._walk_stmt(child, points, loop_counters, func_name, func_depth, seen)
            elif body is not None:
                # R3 (M4) policy: NO LOOP_ITER for braceless single-statement
                # bodies. One statement is one step and the STATE emitted above
                # already covers it; an extra iter event would inflate scrubber
                # step counts without adding variables.
                self._walk_stmt(body, points, loop_counters, func_name, func_depth, seen)
            return

        # ── Compound statement → recurse ──────────────────────────────────────
        if kind == clang.CursorKind.COMPOUND_STMT:
            for child in cursor.get_children():
                self._walk_stmt(child, points, loop_counters, func_name, func_depth, seen)
            return

        # Default: expression / assignment / call / DECL_STMT inside a nested
        # body. STATE for its line was already emitted above; nothing more to
        # recurse into (children are expressions, not statements).
        return


def walk(source_path: str, extra_args: list[str] | None = None) -> WalkResult:
    """Convenience function — create a walker and walk the source file.

    Args:
        source_path: Path to the .cpp file to analyse.
        extra_args: Additional clang flags.

    Returns:
        WalkResult with all injection points and loop counter declarations needed.
    """
    return ASTWalker(source_path, extra_args).walk()
