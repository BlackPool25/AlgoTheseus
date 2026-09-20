"""
core/trace/static_cfg.py — Robust static Control Flow Graph builder using libclang AST.

Constructs a full, textbook Control Flow Graph (CFG) for user C++ programs:
  - Functions start at FUNC_START and exit at FUNC_END.
  - Linear statements are grouped into cohesive LINE basic blocks.
  - If/else statements create diamond BRANCH nodes with explicit [true] and [false] paths,
    converging at the merge / join point.
  - Loops (while, for, do-while, range-for) create LOOP condition nodes with [true] entering
    the body, back-edges looping back, and [false] exiting to the join point.
  - Jump statements (break, continue, return) route to loop exits, loop headers, or function ends.
  - Runtime trace events are mapped onto this complete graph, activating nodes and edges
    as the user scrubs through execution steps while keeping untaken branches visible.
"""

from __future__ import annotations

import logging
import os
import tempfile
from dataclasses import dataclass, field
from typing import Any

import clang.cindex as clang

from app.core.instrumenter import _libclang_compat
from app.core.trace.models import CFGEdge, CFGNode, CFGNodeType

logger = logging.getLogger(__name__)

_lib = _libclang_compat.ensure_libclang()


def _get_stmt_line(cursor: clang.Cursor) -> int:
    """Get the primary user source line for a cursor."""
    if cursor.location.file and cursor.location.line > 0:
        return cursor.location.line
    for c in cursor.get_children():
        line = _get_stmt_line(c)
        if line > 0:
            return line
    return 0


def _get_cond_text(cursor: clang.Cursor, source_lines: list[str]) -> str:
    """Extract condition expression text from source lines."""
    try:
        s = cursor.extent.start
        e = cursor.extent.end
        if s.line == e.line and 1 <= s.line <= len(source_lines):
            line = source_lines[s.line - 1]
            text = line[s.column - 1 : e.column - 1].strip()
            if text:
                return text
        elif s.line < e.line and 1 <= s.line <= len(source_lines):
            parts = []
            parts.append(source_lines[s.line - 1][s.column - 1 :].rstrip("\n"))
            for lineno in range(s.line + 1, min(e.line, len(source_lines))):
                parts.append(source_lines[lineno - 1].rstrip("\n"))
            if e.line <= len(source_lines):
                parts.append(source_lines[e.line - 1][: e.column - 1])
            return " ".join(" ".join(parts).split())
    except Exception:
        pass
    return "..."


def _get_for_header(
    cursor: clang.Cursor, body: clang.Cursor | None, source_lines: list[str]
) -> str:
    """Extract for loop header expression text from source lines."""
    line = _get_stmt_line(cursor)
    try:
        s = cursor.extent.start
        if 1 <= s.line <= len(source_lines):
            if body and body.extent.start.line:
                b = body.extent.start
                if s.line == b.line:
                    txt = source_lines[s.line - 1][s.column - 1 : b.column - 1].strip()
                    res = txt.rstrip("{").strip()
                    if res:
                        return res
                elif s.line < b.line:
                    txt = source_lines[s.line - 1][s.column - 1 :].strip()
                    res = txt.rstrip("{").strip()
                    if res:
                        return res
            txt = source_lines[s.line - 1].strip()
            if txt.endswith("{"):
                txt = txt[:-1].strip()
            if txt.startswith("for"):
                return txt
    except Exception:
        pass
    return f"for (line {line})"


@dataclass
class _EdgePending:
    source: str
    label: str = ""
    source_handle: str | None = None


class StaticCFGBuilder:
    def __init__(self, source_code: str):
        self.source_code = source_code
        self.source_lines = source_code.splitlines()
        self.nodes: list[CFGNode] = []
        self.edges: list[CFGEdge] = []
        self._counter: int = 0
        self._seen_edges: set[tuple[str, str, str, str | None]] = set()

    def new_id(self, prefix: str = "n") -> str:
        self._counter += 1
        return f"{prefix}_{self._counter}"

    def add_node(self, node: CFGNode) -> CFGNode:
        self.nodes.append(node)
        return node

    def add_edge(
        self, source: str, target: str, label: str = "", source_handle: str | None = None
    ) -> None:
        if source == target:
            return
        key = (source, target, label, source_handle)
        if key in self._seen_edges:
            return
        self._seen_edges.add(key)
        self.edges.append(
            CFGEdge(source=source, target=target, label=label, source_handle=source_handle)
        )

    def connect_pending(self, pending: list[_EdgePending], target_id: str) -> None:
        for p in pending:
            self.add_edge(p.source, target_id, p.label, p.source_handle)

    def build(self) -> tuple[list[CFGNode], list[CFGEdge]]:
        with tempfile.NamedTemporaryFile(suffix=".cpp", mode="w", delete=False, encoding="utf-8") as f:
            f.write(self.source_code)
            path = f.name

        try:
            index = clang.Index.create()
            tu = index.parse(path, args=_libclang_compat.default_extra_args())
            abs_path = os.path.abspath(path)

            for cursor in tu.cursor.get_children():
                if (
                    cursor.location.file
                    and os.path.abspath(cursor.location.file.name) == abs_path
                    and cursor.kind in (clang.CursorKind.FUNCTION_DECL, clang.CursorKind.CXX_METHOD)
                    and cursor.is_definition()
                ):
                    self._build_function(cursor)

            return self.nodes, self.edges
        finally:
            try:
                os.unlink(path)
            except OSError:
                pass

    def _build_function(self, fn_cursor: clang.Cursor) -> None:
        fn_name = fn_cursor.spelling
        fn_line = fn_cursor.location.line
        body = next(
            (c for c in fn_cursor.get_children() if c.kind == clang.CursorKind.COMPOUND_STMT),
            None,
        )
        if not body:
            return

        start_id = self.new_id("func_start")
        self.add_node(
            CFGNode(
                id=start_id,
                type=CFGNodeType.FUNC_START,
                lines=[fn_line],
                label=f"{fn_name}()",
                trace_indices=[],
            )
        )

        end_id = self.new_id("func_end")
        end_line = fn_cursor.extent.end.line if fn_cursor.extent.end else fn_line

        exits = self._build_compound_stmt(
            body, [_EdgePending(source=start_id)], loop_ctx=None, end_id=end_id
        )

        self.connect_pending(exits, end_id)
        self.add_node(
            CFGNode(
                id=end_id,
                type=CFGNodeType.FUNC_END,
                lines=[end_line],
                label="return",
                trace_indices=[],
            )
        )

    def _build_compound_stmt(
        self,
        compound: clang.Cursor,
        in_edges: list[_EdgePending],
        loop_ctx: dict[str, Any] | None,
        end_id: str,
    ) -> list[_EdgePending]:
        children = list(compound.get_children())
        cur_edges = in_edges
        i = 0
        n = len(children)

        while i < n:
            child = children[i]
            kind = child.kind

            # Coalesce consecutive simple statements into a single LINE node
            if self._is_simple_stmt(kind):
                group_stmts = [child]
                while (
                    i + 1 < n
                    and self._is_simple_stmt(children[i + 1].kind)
                    and abs(
                        _get_stmt_line(children[i + 1])
                        - _get_stmt_line(group_stmts[-1])
                    )
                    <= 3
                ):
                    i += 1
                    group_stmts.append(children[i])

                lines = [_get_stmt_line(s) for s in group_stmts if _get_stmt_line(s) > 0]
                lines = sorted(set(lines))
                if not lines:
                    i += 1
                    continue

                line_id = self.new_id("line")
                if len(lines) == 1:
                    label = f"line {lines[0]}"
                else:
                    label = f"lines {lines[0]}–{lines[-1]}"

                self.add_node(
                    CFGNode(
                        id=line_id,
                        type=CFGNodeType.LINE,
                        lines=lines,
                        label=label,
                        trace_indices=[],
                    )
                )
                self.connect_pending(cur_edges, line_id)
                cur_edges = [_EdgePending(source=line_id)]
                i += 1
                continue

            cur_edges = self._build_stmt(child, cur_edges, loop_ctx, end_id)
            i += 1
            if not cur_edges:
                break

        return cur_edges

    @staticmethod
    def _is_simple_stmt(kind: clang.CursorKind | None) -> bool:
        """True if the statement is a basic instruction with no internal branching."""
        if kind is None:
            return False
        simple_kinds = {
            clang.CursorKind.DECL_STMT,
            clang.CursorKind.BINARY_OPERATOR,
            clang.CursorKind.UNARY_OPERATOR,
            clang.CursorKind.COMPOUND_ASSIGNMENT_OPERATOR,
            clang.CursorKind.CALL_EXPR,
            clang.CursorKind.UNEXPOSED_EXPR,
            clang.CursorKind.NULL_STMT,
        }
        cxx_op = getattr(clang.CursorKind, "CXX_OPERATOR_CALL_EXPR", None)
        if cxx_op is not None:
            simple_kinds.add(cxx_op)
        return kind in simple_kinds

    def _build_stmt(
        self,
        cursor: clang.Cursor,
        in_edges: list[_EdgePending],
        loop_ctx: dict[str, Any] | None,
        end_id: str,
    ) -> list[_EdgePending]:
        if not in_edges:
            return []

        kind = cursor.kind
        line = _get_stmt_line(cursor)

        if kind == clang.CursorKind.COMPOUND_STMT:
            return self._build_compound_stmt(cursor, in_edges, loop_ctx, end_id)

        # ── IF Statement ───────────────────────────────────────────────────────
        if kind == clang.CursorKind.IF_STMT:
            children = list(cursor.get_children())
            if not children:
                return in_edges

            cond = children[0]
            then_branch = children[1] if len(children) > 1 else None
            else_branch = children[2] if len(children) > 2 else None

            cond_text = _get_cond_text(cond, self.source_lines)
            branch_id = self.new_id("branch")
            self.add_node(
                CFGNode(
                    id=branch_id,
                    type=CFGNodeType.BRANCH,
                    lines=[line],
                    label=f"if ({cond_text})",
                    trace_indices=[],
                )
            )
            self.connect_pending(in_edges, branch_id)

            # Then path [true]
            then_in = [_EdgePending(source=branch_id, label="true", source_handle="true")]
            then_out = (
                self._build_stmt(then_branch, then_in, loop_ctx, end_id)
                if then_branch
                else then_in
            )

            # Else path [false]
            if else_branch:
                else_in = [_EdgePending(source=branch_id, label="false", source_handle="false")]
                else_out = self._build_stmt(else_branch, else_in, loop_ctx, end_id)
            else:
                # No else: false edge goes straight to the join point
                else_out = [_EdgePending(source=branch_id, label="false", source_handle="false")]

            return then_out + else_out

        # ── While / For / Range-For Loops ─────────────────────────────────────
        range_for_kind = getattr(clang.CursorKind, "CXX_FOR_RANGE_STMT", None)
        if kind in (clang.CursorKind.WHILE_STMT, clang.CursorKind.FOR_STMT, range_for_kind):
            children = list(cursor.get_children())
            loop_id = self.new_id("loop")

            if kind == clang.CursorKind.WHILE_STMT and children:
                cond = children[0]
                cond_text = _get_cond_text(cond, self.source_lines)
                label = f"while ({cond_text})"
                body = children[-1] if len(children) > 1 else None
            elif kind == clang.CursorKind.FOR_STMT:
                body = children[-1] if children else None
                label = _get_for_header(cursor, body, self.source_lines)
            else:
                body = children[-1] if children else None
                label = _get_for_header(cursor, body, self.source_lines)

            self.add_node(
                CFGNode(
                    id=loop_id,
                    type=CFGNodeType.LOOP,
                    lines=[line],
                    label=label,
                    trace_indices=[],
                )
            )
            self.connect_pending(in_edges, loop_id)

            break_edges: list[_EdgePending] = []
            cont_edges: list[_EdgePending] = []
            sub_ctx = {
                "breaks": break_edges,
                "continues": cont_edges,
                "head": loop_id,
            }

            body_in = [_EdgePending(source=loop_id, label="true", source_handle="true")]
            body_out = self._build_stmt(body, body_in, sub_ctx, end_id) if body else body_in

            # Back-edges to loop condition
            for p in body_out + cont_edges:
                self.add_edge(p.source, loop_id, p.label, p.source_handle)

            # Loop exit [false] + break exits
            return [_EdgePending(source=loop_id, label="false", source_handle="false")] + break_edges

        # ── Do-While Loop ─────────────────────────────────────────────────────
        if kind == clang.CursorKind.DO_STMT:
            children = list(cursor.get_children())
            body = children[0] if children else None
            cond = children[1] if len(children) > 1 else None
            cond_text = _get_cond_text(cond, self.source_lines) if cond else "..."

            break_edges = []
            cont_edges = []
            cond_id = self.new_id("loop")

            sub_ctx = {
                "breaks": break_edges,
                "continues": cont_edges,
                "head": cond_id,
            }

            # Body runs first
            body_out = self._build_stmt(body, in_edges, sub_ctx, end_id) if body else in_edges

            # Condition node
            self.add_node(
                CFGNode(
                    id=cond_id,
                    type=CFGNodeType.LOOP,
                    lines=[cond.location.line if cond and cond.location.line else line],
                    label=f"while ({cond_text})",
                    trace_indices=[],
                )
            )
            self.connect_pending(body_out + cont_edges, cond_id)

            # True back to body start (we connect to the first node in body or condition)
            first_body_node = body_out[0].source if body_out else cond_id
            self.add_edge(cond_id, first_body_node, label="true", source_handle="true")

            return [_EdgePending(source=cond_id, label="false", source_handle="false")] + break_edges

        # ── Return Statement ──────────────────────────────────────────────────
        if kind == clang.CursorKind.RETURN_STMT:
            ret_id = self.new_id("ret")
            self.add_node(
                CFGNode(
                    id=ret_id,
                    type=CFGNodeType.LINE,
                    lines=[line],
                    label=f"return (line {line})",
                    trace_indices=[],
                )
            )
            self.connect_pending(in_edges, ret_id)
            self.add_edge(ret_id, end_id, label="")
            return []  # No forward fallthrough

        # ── Break Statement ───────────────────────────────────────────────────
        if kind == clang.CursorKind.BREAK_STMT:
            if loop_ctx is not None:
                loop_ctx["breaks"].extend(in_edges)
            return []

        # ── Continue Statement ────────────────────────────────────────────────
        if kind == clang.CursorKind.CONTINUE_STMT:
            if loop_ctx is not None:
                loop_ctx["continues"].extend(in_edges)
            return []

        # ── General Fallback Line Node ────────────────────────────────────────
        node_id = self.new_id("line")
        self.add_node(
            CFGNode(
                id=node_id,
                type=CFGNodeType.LINE,
                lines=[line],
                label=f"line {line}",
                trace_indices=[],
            )
        )
        self.connect_pending(in_edges, node_id)
        return [_EdgePending(source=node_id)]


def build_static_cfg(
    source_code: str, events: list[Any]
) -> tuple[list[CFGNode], list[CFGEdge]] | None:
    """Build a complete static CFG and overlay runtime trace event indices.

    Returns (nodes, edges) if static analysis succeeds, or None to fall back.
    """
    try:
        builder = StaticCFGBuilder(source_code)
        nodes, edges = builder.build()
        if not nodes:
            return None

        # Build index: (func_name, line) -> list of matching nodes
        # We also maintain a line -> nodes lookup
        line_to_nodes: dict[int, list[CFGNode]] = {}
        for n in nodes:
            for l in n.lines:
                line_to_nodes.setdefault(l, []).append(n)

        branch_evaluations: dict[str, set[bool]] = {}

        # Overlay trace events onto the static nodes
        for idx, event in enumerate(events):
            evt_line = getattr(event, "line", None)
            if evt_line is None or evt_line not in line_to_nodes:
                continue

            candidates = line_to_nodes[evt_line]
            matched = False

            # Type-specific matching if possible
            evt_type = getattr(event, "type", None)
            for cand in candidates:
                if evt_type == "branch" and cand.type == CFGNodeType.BRANCH:
                    cand.trace_indices.append(idx)
                    tk = getattr(event, "taken", None)
                    if tk is not None:
                        branch_evaluations.setdefault(cand.id, set()).add(bool(tk))
                    matched = True
                    break
                elif evt_type == "iter" and cand.type == CFGNodeType.LOOP:
                    cand.trace_indices.append(idx)
                    matched = True
                    break

            if not matched and candidates:
                # Default to the first candidate covering this line
                candidates[0].trace_indices.append(idx)

        untaken_node_ids = {n.id for n in nodes if len(n.trace_indices) == 0}
        for n in nodes:
            n.is_untaken = n.id in untaken_node_ids

        for e in edges:
            if e.source in untaken_node_ids or e.target in untaken_node_ids:
                e.is_untaken = True
            elif e.label == "true" and e.source in branch_evaluations:
                if True not in branch_evaluations[e.source]:
                    e.is_untaken = True
            elif e.label == "false" and e.source in branch_evaluations:
                if False not in branch_evaluations[e.source]:
                    e.is_untaken = True

        return nodes, edges
    except Exception as e:
        logger.warning("Static CFG build failed, falling back to dynamic CFG: %s", e)
        return None
