"""
trace/cfg_builder.py — Builds a dynamic CFG from the flat trace.

We do NOT do static CFG analysis (too complex for C++). Instead we build
the CFG dynamically from the trace itself:

  - Walk the trace linearly.
  - Group consecutive STATE events in the same function into a LINE node
    until a discontinuity (line jump, branch, call, or function change).
  - BRANCH events create a BRANCH node.
  - LOOP_ITER events: first iteration creates a LOOP node; subsequent
    iterations at the same line add to its child list.
  - FUNC_ENTER creates a FUNC_START node and opens a sub-graph.
  - FUNC_EXIT creates a FUNC_END node.

Each CFG node stores trace_indices — the indices into the flat trace that
map to this node. This is how the scrubber and flowchart stay in sync.

Gotcha: Recursion is detected when func_enter.func == current_func.
We build a recursive call tree in that case.

Gotcha: Node IDs must be unique across the entire graph. We use a counter.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .models import (
    BranchEvent,
    CFGEdge,
    CFGNode,
    CFGNodeType,
    EventType,
    FuncEnterEvent,
    FuncExitEvent,
    LoopIterEvent,
    StateEvent,
)


@dataclass
class _BuildState:
    """Mutable state threaded through the builder."""
    nodes: list[CFGNode] = field(default_factory=list)
    edges: list[CFGEdge] = field(default_factory=list)
    _counter: int = 0

    def new_id(self, prefix: str = "n") -> str:
        self._counter += 1
        return f"{prefix}_{self._counter}"

    def add_node(self, node: CFGNode) -> None:
        self.nodes.append(node)

    def add_edge(self, source: str, target: str, label: str = "") -> None:
        self.edges.append(CFGEdge(source=source, target=target, label=label))


def build(events: list[Any]) -> tuple[list[CFGNode], list[CFGEdge]]:
    """Build a CFG from a flat list of trace events.

    Args:
        events: List of TraceEvent objects from parser.parse().

    Returns:
        Tuple of (nodes, edges) for the React Flow graph.
    """
    state = _BuildState()

    # Track the current "open" LINE node being accumulated
    current_line_node: CFGNode | None = None
    current_func: str = ""
    prev_node_id: str | None = None

    # Loop node tracking: (func, line) → node_id
    loop_nodes: dict[tuple[str, int], str] = {}
    current_loop_id: str | None = None

    # Recursion tracking: func_name → list of active call depths (for detecting recursion)
    active_funcs: dict[str, list[int]] = {}

    def flush_line_node() -> None:
        nonlocal current_line_node, prev_node_id
        if current_line_node is not None:
            state.add_node(current_line_node)
            if prev_node_id:
                state.add_edge(prev_node_id, current_line_node.id)
            prev_node_id = current_line_node.id
            current_line_node = None

    def add_to_current_loop(node_id: str) -> None:
        nonlocal current_loop_id
        if current_loop_id is not None:
            loop_node = next(n for n in state.nodes if n.id == current_loop_id)
            loop_node.children.append(node_id)

    for idx, event in enumerate(events):
        t = event.type

        if t == EventType.FUNC_ENTER:
            flush_line_node()
            fn = event.func
            depth = event.depth

            # Detect recursion: same function already active at a lower depth
            is_recursive = fn in active_funcs and len(active_funcs[fn]) > 0

            active_funcs.setdefault(fn, []).append(depth)

            if is_recursive:
                # Recursive call — create a FUNC_CALL node instead of FUNC_START
                node_id = state.new_id("func_call")
                node = CFGNode(
                    id=node_id,
                    type=CFGNodeType.FUNC_CALL,
                    lines=[event.line],
                    label=f"↻ {fn}() [depth {depth}]",
                    trace_indices=[idx],
                )
            else:
                node_id = state.new_id("func_start")
                node = CFGNode(
                    id=node_id,
                    type=CFGNodeType.FUNC_START,
                    lines=[event.line],
                    label=f"{fn}()",
                    trace_indices=[idx],
                )
            state.add_node(node)
            if prev_node_id:
                state.add_edge(prev_node_id, node_id)
            prev_node_id = node_id
            current_func = fn

        elif t == EventType.FUNC_EXIT:
            flush_line_node()
            current_loop_id = None  # loop scope ends
            fn = event.func
            # Pop from active_funcs
            if fn in active_funcs and active_funcs[fn]:
                active_funcs[fn].pop()

            node_id = state.new_id("func_end")
            ret_label = f"→ {event.return_val}" if event.return_val is not None else "return"
            node = CFGNode(
                id=node_id,
                type=CFGNodeType.FUNC_END,
                lines=[event.line],
                label=ret_label,
                trace_indices=[idx],
            )
            state.add_node(node)
            if prev_node_id:
                state.add_edge(prev_node_id, node_id)
            prev_node_id = node_id

        elif t == EventType.STATE:
            # Accumulate into current LINE node or start a new one
            if current_line_node is None:
                node_id = state.new_id("line")
                current_line_node = CFGNode(
                    id=node_id,
                    type=CFGNodeType.LINE,
                    lines=[event.line],
                    label=f"line {event.line}",
                    trace_indices=[idx],
                )
                add_to_current_loop(node_id)
            else:
                # Continue accumulating if same function and adjacent lines
                if event.func == current_func and abs(event.line - current_line_node.lines[-1]) <= 3:
                    current_line_node.lines.append(event.line)
                    current_line_node.trace_indices.append(idx)
                    current_line_node.label = f"lines {current_line_node.lines[0]}–{event.line}"
                else:
                    # Discontinuity — flush and start new node
                    flush_line_node()
                    node_id = state.new_id("line")
                    current_line_node = CFGNode(
                        id=node_id,
                        type=CFGNodeType.LINE,
                        lines=[event.line],
                        label=f"line {event.line}",
                        trace_indices=[idx],
                    )
                    add_to_current_loop(node_id)
            current_func = event.func

        elif t == EventType.BRANCH:
            flush_line_node()
            node_id = state.new_id("branch")
            taken_label = "true" if event.taken else "false"
            node = CFGNode(
                id=node_id,
                type=CFGNodeType.BRANCH,
                lines=[event.line],
                label=f"if ({event.condition})",
                trace_indices=[idx],
            )
            state.add_node(node)
            add_to_current_loop(node_id)
            if prev_node_id:
                state.add_edge(prev_node_id, node_id, taken_label)
            prev_node_id = node_id

        elif t == EventType.LOOP_ITER:
            flush_line_node()
            key = (event.func, event.line)
            if key not in loop_nodes:
                # First iteration — create the LOOP node
                node_id = state.new_id("loop")
                node = CFGNode(
                    id=node_id,
                    type=CFGNodeType.LOOP,
                    lines=[event.line],
                    label=f"loop (iter {event.iteration + 1})",
                    trace_indices=[idx],
                )
                state.add_node(node)
                if prev_node_id:
                    state.add_edge(prev_node_id, node_id)
                loop_nodes[key] = node_id
                current_loop_id = node_id
                prev_node_id = node_id
            else:
                # Subsequent iteration — update the existing LOOP node
                existing = next(n for n in state.nodes if n.id == loop_nodes[key])
                existing.trace_indices.append(idx)
                existing.label = f"loop (iter {event.iteration + 1})"

    flush_line_node()

    return state.nodes, state.edges
