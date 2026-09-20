"""
tests/test_static_cfg.py — Comprehensive unit tests for static CFG tree/flowchart builder.
"""

import pytest

from app.core.trace.cfg_builder import build as build_cfg
from app.core.trace.models import (
    BranchEvent,
    CFGNodeType,
    EventType,
    FuncEnterEvent,
    FuncExitEvent,
    StateEvent,
)
from app.core.trace.static_cfg import StaticCFGBuilder, build_static_cfg


def test_if_else_diamond():
    code = """
    void solve(int x) {
        if (x > 0) {
            int a = 1;
        } else {
            int b = 2;
        }
        int c = 3;
    }
    """
    nodes, edges = build_static_cfg(code, [])
    assert nodes is not None
    assert edges is not None

    node_types = {n.type for n in nodes}
    assert CFGNodeType.FUNC_START in node_types
    assert CFGNodeType.FUNC_END in node_types
    assert CFGNodeType.BRANCH in node_types

    branch_nodes = [n for n in nodes if n.type == CFGNodeType.BRANCH]
    assert len(branch_nodes) == 1
    branch = branch_nodes[0]
    assert "x > 0" in branch.label

    # Find outgoing edges from branch
    out_edges = [e for e in edges if e.source == branch.id]
    assert len(out_edges) == 2

    true_edge = next(e for e in out_edges if e.label == "true")
    false_edge = next(e for e in out_edges if e.label == "false")
    assert true_edge.source_handle == "true"
    assert false_edge.source_handle == "false"
    assert true_edge.target != false_edge.target

    # Find merge node (line containing 'int c = 3')
    merge_nodes = [n for n in nodes if 8 in n.lines or "int c = 3" in n.label]
    assert len(merge_nodes) >= 1
    merge_id = merge_nodes[0].id

    # Both paths should eventually converge to merge_id
    true_target_out = [e for e in edges if e.source == true_edge.target]
    false_target_out = [e for e in edges if e.source == false_edge.target]
    assert any(e.target == merge_id for e in true_target_out)
    assert any(e.target == merge_id for e in false_target_out)


def test_single_if_bypass():
    code = """
    void solve(int x) {
        if (x > 0) {
            int a = 1;
        }
        int c = 3;
    }
    """
    nodes, edges = build_static_cfg(code, [])
    branch = next(n for n in nodes if n.type == CFGNodeType.BRANCH)
    join_node = next(n for n in nodes if n.type == CFGNodeType.LINE and 6 in n.lines)

    # In single if, false edge bypasses directly to join node
    false_edge = next(e for e in edges if e.source == branch.id and e.label == "false")
    assert false_edge.target == join_node.id
    assert false_edge.source_handle == "false"


def test_for_loop_header_and_edges():
    code = """
    void loop_test(int n) {
        for (int i = 0; i < n; i++) {
            int x = i;
        }
        int done = 1;
    }
    """
    nodes, edges = build_static_cfg(code, [])
    loop_node = next(n for n in nodes if n.type == CFGNodeType.LOOP)
    assert "for (int i = 0; i < n; i++)" in loop_node.label

    # True edge enters loop body
    true_edge = next(e for e in edges if e.source == loop_node.id and e.label == "true")
    assert true_edge.source_handle == "true"

    # Back-edge from body back to loop header
    body_target = true_edge.target
    back_edge = next(e for e in edges if e.source == body_target and e.target == loop_node.id)
    assert back_edge is not None

    # False edge exits loop to 'int done = 1'
    false_edge = next(e for e in edges if e.source == loop_node.id and e.label == "false")
    done_node = next(n for n in nodes if 6 in n.lines)
    assert false_edge.target == done_node.id


def test_loop_break_and_continue():
    code = """
    void test_jumps(int n) {
        for (int i = 0; i < n; i++) {
            if (i == 2) continue;
            if (i == 5) break;
            int y = 1;
        }
        int end = 0;
    }
    """
    nodes, edges = build_static_cfg(code, [])
    loop_node = next(n for n in nodes if n.type == CFGNodeType.LOOP)
    end_node = next(n for n in nodes if 8 in n.lines)

    cont_branch = next(n for n in nodes if "i == 2" in n.label)
    break_branch = next(n for n in nodes if "i == 5" in n.label)

    # continue edge connects back to loop condition
    cont_edge = next(e for e in edges if e.source == cont_branch.id and e.label == "true")
    assert cont_edge.target == loop_node.id

    # break edge connects directly to loop exit
    break_edge = next(e for e in edges if e.source == break_branch.id and e.label == "true")
    assert break_edge.target == end_node.id


def test_return_statement():
    code = """
    void test_ret(int x) {
        if (x < 0) {
            return;
        }
        int y = 10;
    }
    """
    nodes, edges = build_static_cfg(code, [])
    end_node = next(n for n in nodes if n.type == CFGNodeType.FUNC_END)
    branch = next(n for n in nodes if n.type == CFGNodeType.BRANCH)
    fallthrough_node = next(n for n in nodes if 6 in n.lines)

    # Return statement node connects to FUNC_END
    ret_edge = next(e for e in edges if e.target == end_node.id and e.source != fallthrough_node.id)
    ret_node = next(n for n in nodes if n.id == ret_edge.source)
    assert "return" in ret_node.label


def test_trace_overlay_and_untaken_marking():
    code = """
    void solve(int x) {
        if (x > 0) {
            int a = 1;
        } else {
            int b = 2;
        }
        int c = 3;
    }
    """
    events = [
        FuncEnterEvent(t=EventType.FUNC_ENTER, l=2, f="solve", d=1, p={"x": 5}),
        BranchEvent(t=EventType.BRANCH, l=3, f="solve", d=1, c="x > 0", tk=True),
        StateEvent(t=EventType.STATE, l=4, f="solve", d=1, v={"a": 1}),
        StateEvent(t=EventType.STATE, l=8, f="solve", d=1, v={"c": 3}),
        FuncExitEvent(t=EventType.FUNC_EXIT, l=9, f="solve", d=1, r=None),
    ]

    nodes, edges = build_static_cfg(code, events)

    start_node = next(n for n in nodes if n.type == CFGNodeType.FUNC_START)
    branch_node = next(n for n in nodes if n.type == CFGNodeType.BRANCH)
    then_node = next(n for n in nodes if 4 in n.lines)
    else_node = next(n for n in nodes if 6 in n.lines)
    join_node = next(n for n in nodes if 8 in n.lines)

    assert not start_node.is_untaken
    assert not branch_node.is_untaken
    assert not then_node.is_untaken
    assert else_node.is_untaken  # Untaken branch!
    assert not join_node.is_untaken

    # Edge untaken states
    true_edge = next(e for e in edges if e.source == branch_node.id and e.target == then_node.id)
    false_edge = next(e for e in edges if e.source == branch_node.id and e.target == else_node.id)
    else_out_edge = next(e for e in edges if e.source == else_node.id and e.target == join_node.id)

    assert not true_edge.is_untaken
    assert false_edge.is_untaken
    assert else_out_edge.is_untaken


def test_cfg_builder_fallback_when_syntax_invalid():
    bad_code = "this is not valid C++ code at all !!! {"
    events = [
        FuncEnterEvent(t=EventType.FUNC_ENTER, l=1, f="main", d=1, p={}),
        StateEvent(t=EventType.STATE, l=2, f="main", d=1, v={"x": 1}),
        FuncExitEvent(t=EventType.FUNC_EXIT, l=3, f="main", d=1, r=None),
    ]

    # Should gracefully fall back to dynamic CFG without raising an exception
    nodes, edges = build_cfg(events, code=bad_code)
    assert len(nodes) > 0
    assert len(edges) > 0


def test_class_member_methods():
    code = """
    class Solution {
    public:
        int solve(int x) {
            if (x > 0) return 1;
            return 0;
        }
    };
    """
    nodes, edges = build_static_cfg(code, [])
    assert nodes is not None
    start_node = next(n for n in nodes if n.type == CFGNodeType.FUNC_START)
    assert start_node.label == "Solution::solve()"


def test_switch_statement_multiway_branch():
    code = """
    void test_sw(int x) {
        switch (x) {
            case 1:
                int a = 1;
                break;
            case 2:
                int b = 2;
                break;
            default:
                int c = 3;
                break;
        }
        int end = 0;
    }
    """
    nodes, edges = build_static_cfg(code, [])
    switch_node = next(n for n in nodes if "switch" in n.label)
    end_node = next(n for n in nodes if 14 in n.lines)

    case1_edge = next(e for e in edges if e.source == switch_node.id and e.label == "case 1")
    case2_edge = next(e for e in edges if e.source == switch_node.id and e.label == "case 2")
    default_edge = next(e for e in edges if e.source == switch_node.id and e.label == "default")

    # All branches eventually converge to end_node
    case1_out = [e for e in edges if e.source == case1_edge.target]
    case2_out = [e for e in edges if e.source == case2_edge.target]
    default_out = [e for e in edges if e.source == default_edge.target]

    assert any(e.target == end_node.id for e in case1_out)
    assert any(e.target == end_node.id for e in case2_out)
    assert any(e.target == end_node.id for e in default_out)


def test_try_catch_block():
    code = """
    void test_ex() {
        try {
            int a = 1;
        } catch (int e) {
            int b = 2;
        }
        int end = 0;
    }
    """
    nodes, edges = build_static_cfg(code, [])
    catch_edge = next(e for e in edges if e.label == "catch")
    assert catch_edge is not None


def test_func_call_and_code_labels():
    code = """
    int helper(int a) {
        return a + 1;
    }
    int main() {
        int x = 10;
        int y = helper(x);
        return 0;
    }
    """
    nodes, edges = build_static_cfg(code, [])
    assert nodes is not None

    # Verify helper() and main() nodes
    helper_nodes = [n for n in nodes if n.func == "helper"]
    main_nodes = [n for n in nodes if n.func == "main"]
    assert len(helper_nodes) >= 3
    assert len(main_nodes) >= 4

    # Verify func_call node is detected for helper(x)
    call_nodes = [n for n in nodes if n.type == CFGNodeType.FUNC_CALL]
    assert len(call_nodes) == 1
    assert call_nodes[0].call_target == "helper"
    assert "helper(x)" in call_nodes[0].label

    # Verify real source statements in labels
    assert any("int x = 10;" in n.label for n in main_nodes)
    assert any("return 0;" in n.label for n in main_nodes)
    assert any("return a + 1;" in n.label for n in helper_nodes)
