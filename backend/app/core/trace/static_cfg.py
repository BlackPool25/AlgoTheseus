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
    target_handle: str | None = None


class StaticCFGBuilder:
    def __init__(self, source_code: str):
        self.source_code = source_code
        self.source_lines = source_code.splitlines()
        self.nodes: list[CFGNode] = []
        self.edges: list[CFGEdge] = []
        self._counter: int = 0
        self._seen_edges: set[tuple[str, str, str, str | None, str | None]] = set()
        self._current_func: str = ""
        self.user_func_names: set[str] = set()

    def _extract_source_lines(self, lines: list[int], max_statements: int = 3) -> str:
        """Extract clean C++ code statements corresponding to line numbers."""
        if not lines:
            return ""
        valid_lines = [ln for ln in lines if 1 <= ln <= len(self.source_lines)]
        if not valid_lines:
            return f"line {lines[0]}" if len(lines) == 1 else f"lines {lines[0]}–{lines[-1]}"

        extracted: list[str] = []
        for ln in valid_lines:
            raw = self.source_lines[ln - 1].strip()
            if raw and raw not in ("{", "}"):
                extracted.append(raw)

        if not extracted:
            return f"line {lines[0]}" if len(lines) == 1 else f"lines {lines[0]}–{lines[-1]}"

        if len(extracted) > max_statements:
            return "\n".join(extracted[:max_statements]) + f"\n... (+{len(extracted) - max_statements} lines)"
        return "\n".join(extracted)

    def _extract_cursor_text(self, cursor: clang.Cursor) -> str:
        """Extract clean text for a statement cursor from its extent."""
        try:
            s = cursor.extent.start
            e = cursor.extent.end
            if s.line and e.line and 1 <= s.line <= len(self.source_lines):
                if s.line == e.line:
                    txt = self.source_lines[s.line - 1][s.column - 1 : e.column - 1].strip()
                    if txt:
                        if not txt.endswith(";") and not txt.endswith("}"):
                            txt += ";"
                        return txt
                elif s.line < e.line:
                    first = self.source_lines[s.line - 1][s.column - 1 :].strip()
                    last = (
                        self.source_lines[e.line - 1][: e.column - 1].strip()
                        if e.line <= len(self.source_lines)
                        else ""
                    )
                    parts = [first]
                    for ln in range(s.line + 1, min(e.line, len(self.source_lines))):
                        m = self.source_lines[ln - 1].strip()
                        if m:
                            parts.append(m)
                    if last:
                        parts.append(last)
                    return "\n".join(parts[:3])
        except Exception:
            pass
        return self._extract_source_lines([_get_stmt_line(cursor)])

    def _find_user_func_call(self, cursor: clang.Cursor) -> str | None:
        """Detect if cursor or any sub-expression calls a user-defined function."""
        if not self.user_func_names:
            return None
        try:
            tokens = [t.spelling for t in cursor.get_tokens()]
            for i, tok in enumerate(tokens):
                if tok in self.user_func_names and i + 1 < len(tokens) and tokens[i + 1] == "(":
                    return tok
        except Exception:
            pass
        return None

    def new_id(self, prefix: str = "n") -> str:
        self._counter += 1
        return f"{prefix}_{self._counter}"

    def add_node(self, node: CFGNode) -> CFGNode:
        if not node.func and self._current_func:
            node.func = self._current_func
        self.nodes.append(node)
        return node

    def add_edge(
        self,
        source: str,
        target: str,
        label: str = "",
        source_handle: str | None = None,
        target_handle: str | None = None,
    ) -> None:
        if source == target:
            return
        key = (source, target, label, source_handle, target_handle)
        if key in self._seen_edges:
            return
        self._seen_edges.add(key)
        self.edges.append(
            CFGEdge(
                source=source,
                target=target,
                label=label,
                source_handle=source_handle,
                target_handle=target_handle,
            )
        )

    def connect_pending(self, pending: list[_EdgePending], target_id: str) -> None:
        for p in pending:
            self.add_edge(p.source, target_id, p.label, p.source_handle, p.target_handle)

    def build(self) -> tuple[list[CFGNode], list[CFGEdge]]:
        with tempfile.NamedTemporaryFile(suffix=".cpp", mode="w", delete=False, encoding="utf-8") as f:
            f.write(self.source_code)
            path = f.name

        try:
            index = clang.Index.create()
            tu = index.parse(path, args=_libclang_compat.default_extra_args())
            abs_path = os.path.abspath(path)

            def find_functions(c: clang.Cursor) -> list[clang.Cursor]:
                res: list[clang.Cursor] = []
                for child in c.get_children():
                    if not child.location.file:
                        continue
                    try:
                        child_path = os.path.abspath(child.location.file.name)
                    except Exception:
                        continue
                    if child_path != abs_path:
                        continue

                    fn_kinds = {
                        clang.CursorKind.FUNCTION_DECL,
                        clang.CursorKind.CXX_METHOD,
                        clang.CursorKind.CONSTRUCTOR,
                        clang.CursorKind.DESTRUCTOR,
                    }
                    fn_tmpl = getattr(clang.CursorKind, "FUNCTION_TEMPLATE", None)
                    if fn_tmpl:
                        fn_kinds.add(fn_tmpl)

                    if child.kind in fn_kinds and child.is_definition():
                        res.append(child)
                    elif child.kind in (
                        clang.CursorKind.NAMESPACE,
                        clang.CursorKind.CLASS_DECL,
                        clang.CursorKind.STRUCT_DECL,
                        clang.CursorKind.CLASS_TEMPLATE,
                        clang.CursorKind.UNION_DECL,
                    ):
                        res.extend(find_functions(child))
                return res

            funcs = find_functions(tu.cursor)
            self.user_func_names = {c.spelling for c in funcs if c.spelling}

            for cursor in funcs:
                self._build_function(cursor)

            return self.nodes, self.edges
        finally:
            try:
                os.unlink(path)
            except OSError:
                pass

    def _build_function(self, fn_cursor: clang.Cursor) -> None:
        fn_name = fn_cursor.spelling
        self._current_func = fn_name
        fn_line = fn_cursor.location.line
        body = next(
            (c for c in fn_cursor.get_children() if c.kind == clang.CursorKind.COMPOUND_STMT),
            None,
        )
        if not body:
            return

        parent = fn_cursor.semantic_parent
        if parent and parent.spelling and parent.kind in (
            clang.CursorKind.CLASS_DECL,
            clang.CursorKind.STRUCT_DECL,
            clang.CursorKind.NAMESPACE,
        ):
            display_name = f"{parent.spelling}::{fn_name}()"
        else:
            display_name = f"{fn_name}()"

        start_id = self.new_id("func_start")
        self.add_node(
            CFGNode(
                id=start_id,
                type=CFGNodeType.FUNC_START,
                lines=[fn_line],
                label=display_name,
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
                label=f"exit {display_name}",
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
            line = _get_stmt_line(child)

            # Coalesce consecutive simple statements into LINE nodes, or FUNC_CALL if calling a user function
            if self._is_simple_stmt(kind):
                user_call = self._find_user_func_call(child)
                if user_call:
                    call_id = self.new_id("call")
                    label = self._extract_cursor_text(child)
                    self.add_node(
                        CFGNode(
                            id=call_id,
                            type=CFGNodeType.FUNC_CALL,
                            lines=[line] if line > 0 else [],
                            label=label,
                            call_target=user_call,
                            trace_indices=[],
                        )
                    )
                    self.connect_pending(cur_edges, call_id)
                    cur_edges = [_EdgePending(source=call_id)]
                    i += 1
                    continue

                group_stmts = [child]
                while (
                    i + 1 < n
                    and self._is_simple_stmt(children[i + 1].kind)
                    and not self._find_user_func_call(children[i + 1])
                    and abs(
                        _get_stmt_line(children[i + 1])
                        - _get_stmt_line(group_stmts[-1])
                    )
                    <= 3
                    and len(group_stmts) < 3
                ):
                    i += 1
                    group_stmts.append(children[i])

                lines = [_get_stmt_line(s) for s in group_stmts if _get_stmt_line(s) > 0]
                lines = sorted(set(lines))
                if not lines:
                    i += 1
                    continue

                line_id = self.new_id("line")
                lines_texts = [self._extract_cursor_text(s) for s in group_stmts]
                seen_txt = set()
                clean_texts = []
                for t in lines_texts:
                    if t and t not in seen_txt:
                        seen_txt.add(t)
                        clean_texts.append(t)
                label = "\n".join(clean_texts) if clean_texts else self._extract_source_lines(lines)

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

            start_node_idx = len(self.nodes)
            body_in = [_EdgePending(source=loop_id, label="true", source_handle="true")]
            body_out = self._build_stmt(body, body_in, sub_ctx, end_id) if body else body_in

            # Back-edges to loop condition
            for p in cont_edges:
                self.add_edge(p.source, loop_id, label=p.label, source_handle=p.source_handle, target_handle="loop-back")
            for p in body_out:
                # If the body ended with an inner loop, its exit latch back to this loop header carries no label
                source_node = next((n for n in self.nodes if n.id == p.source), None)
                lbl = "" if (source_node and source_node.type == CFGNodeType.LOOP) else p.label
                self.add_edge(p.source, loop_id, label=lbl, source_handle=p.source_handle, target_handle="loop-back")

            loop_node = next(n for n in self.nodes if n.id == loop_id)
            loop_node.children = [self.nodes[idx].id for idx in range(start_node_idx, len(self.nodes))]

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
            self.add_edge(cond_id, first_body_node, label="true", source_handle="true", target_handle="loop-back")

            return [_EdgePending(source=cond_id, label="false", source_handle="false")] + break_edges

        # ── Return Statement ──────────────────────────────────────────────────
        if kind == clang.CursorKind.RETURN_STMT:
            ret_id = self.new_id("ret")
            label = self._extract_cursor_text(cursor)
            if not label or not label.startswith("return"):
                label = f"return"
            self.add_node(
                CFGNode(
                    id=ret_id,
                    type=CFGNodeType.LINE,
                    lines=[line],
                    label=label,
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

        # ── Switch Statement ──────────────────────────────────────────────────
        if kind == clang.CursorKind.SWITCH_STMT:
            children = list(cursor.get_children())
            if not children:
                return in_edges

            cond = children[0]
            cond_text = _get_cond_text(cond, self.source_lines)
            switch_id = self.new_id("branch")
            self.add_node(
                CFGNode(
                    id=switch_id,
                    type=CFGNodeType.BRANCH,
                    lines=[line],
                    label=f"switch ({cond_text})",
                    trace_indices=[],
                )
            )
            self.connect_pending(in_edges, switch_id)

            body = children[1] if len(children) > 1 else None
            if not body:
                return [_EdgePending(source=switch_id)]

            break_edges: list[_EdgePending] = []
            switch_ctx = {
                "breaks": break_edges,
                "continues": loop_ctx["continues"] if loop_ctx else [],
                "head": loop_ctx["head"] if loop_ctx else None,
            }
            cur_case_edges: list[_EdgePending] = []
            has_default = False

            for ch in body.get_children():
                if ch.kind == clang.CursorKind.CASE_STMT:
                    case_children = list(ch.get_children())
                    val_text = _get_cond_text(case_children[0], self.source_lines) if case_children else "?"
                    first_stmt = case_children[1] if len(case_children) > 1 else None
                    in_case = [_EdgePending(source=switch_id, label=f"case {val_text}")] + cur_case_edges
                    cur_case_edges = self._build_stmt(first_stmt, in_case, switch_ctx, end_id) if first_stmt else in_case
                elif ch.kind == clang.CursorKind.DEFAULT_STMT:
                    has_default = True
                    case_children = list(ch.get_children())
                    first_stmt = case_children[0] if case_children else None
                    in_default = [_EdgePending(source=switch_id, label="default")] + cur_case_edges
                    cur_case_edges = self._build_stmt(first_stmt, in_default, switch_ctx, end_id) if first_stmt else in_default
                elif ch.kind == clang.CursorKind.BREAK_STMT:
                    break_edges.extend(cur_case_edges)
                    cur_case_edges = []
                else:
                    cur_case_edges = self._build_stmt(ch, cur_case_edges, switch_ctx, end_id)

            exit_edges = break_edges + cur_case_edges
            if not has_default:
                exit_edges.append(_EdgePending(source=switch_id, label="default"))
            return exit_edges

        # ── Try / Catch Block ─────────────────────────────────────────────────
        if kind == clang.CursorKind.CXX_TRY_STMT:
            children = list(cursor.get_children())
            if not children:
                return in_edges

            try_body = children[0]
            catches = children[1:]

            try_out = self._build_stmt(try_body, in_edges, loop_ctx, end_id)
            catch_outs: list[_EdgePending] = []

            for catch in catches:
                catch_children = list(catch.get_children())
                catch_body = catch_children[-1] if catch_children else None
                if catch_body:
                    catch_in = [_EdgePending(source=in_edges[0].source, label="catch")] if in_edges else []
                    c_out = self._build_stmt(catch_body, catch_in, loop_ctx, end_id)
                    catch_outs.extend(c_out)

            return try_out + catch_outs

        # ── General Fallback Line Node ────────────────────────────────────────
        node_id = self.new_id("line")
        label = self._extract_cursor_text(cursor)
        self.add_node(
            CFGNode(
                id=node_id,
                type=CFGNodeType.LINE,
                lines=[line],
                label=label,
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
            evt_type = getattr(event, "type", None)
            if hasattr(evt_type, "value"):
                evt_type = evt_type.value

            matched = False
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
                elif evt_type in ("exit", "func_exit") and cand.type in (CFGNodeType.FUNC_END, CFGNodeType.LINE):
                    cand.trace_indices.append(idx)
                    matched = True
                    break

            if not matched and candidates:
                # For state events, prefer LINE nodes on this line (statement execution)
                line_nodes = [c for c in candidates if c.type in (CFGNodeType.LINE, CFGNodeType.FUNC_CALL)]
                if line_nodes:
                    for ln in line_nodes:
                        ln.trace_indices.append(idx)
                else:
                    for c in candidates:
                        c.trace_indices.append(idx)

        # Branch evaluations determine edge untaken states
        for e in edges:
            if e.source in branch_evaluations:
                if e.label == "true":
                    e.is_untaken = (True not in branch_evaluations[e.source])
                elif e.label == "false":
                    e.is_untaken = (False not in branch_evaluations[e.source])

        # Propagate taken targets from branches
        taken_target_ids = {e.target for e in edges if not e.is_untaken and e.source in branch_evaluations}

        # If exit node connected from a taken return, mark exit taken
        for e in edges:
            if any(n.type == CFGNodeType.FUNC_END for n in nodes if n.id == e.target):
                src_node = next((n for n in nodes if n.id == e.source), None)
                if src_node and len(src_node.trace_indices) > 0:
                    taken_target_ids.add(e.target)

        untaken_node_ids = {n.id for n in nodes if len(n.trace_indices) == 0 and n.id not in taken_target_ids}
        for n in nodes:
            n.is_untaken = n.id in untaken_node_ids

        for e in edges:
            if e.source in untaken_node_ids or e.target in untaken_node_ids:
                e.is_untaken = True
            elif e.source in branch_evaluations:
                if e.label == "true" and True not in branch_evaluations[e.source]:
                    e.is_untaken = True
                elif e.label == "false" and False not in branch_evaluations[e.source]:
                    e.is_untaken = True

        return nodes, edges
    except Exception as e:
        logger.warning("Static CFG build failed, falling back to dynamic CFG: %s", e)
        return None
