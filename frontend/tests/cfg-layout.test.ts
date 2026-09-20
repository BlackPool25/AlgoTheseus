/**
 * tests/cfg-layout.test.ts — CFG layout, swimlane partitioning, and handle routing tests.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { layoutCFG, invalidateLayoutCache } from "../src/utils/cfgLayout";
import type { CFGEdge, CFGNode } from "../types/cfg";

describe("cfgLayout — multi-function swimlanes and handles", () => {
  it("places disconnected functions in separated horizontal swimlanes without overlap", () => {
    invalidateLayoutCache();

    // Function 1: prim()
    const primNodes: CFGNode[] = [
      { id: "prim_start", type: "func_start", lines: [2], label: "prim()", children: [], trace_indices: [0], is_untaken: false, func: "prim" },
      { id: "prim_body", type: "line", lines: [3], label: "line 3", children: [], trace_indices: [1], is_untaken: false, func: "prim" },
      { id: "prim_end", type: "func_end", lines: [4], label: "return", children: [], trace_indices: [2], is_untaken: false, func: "prim" },
    ];
    const primEdges: CFGEdge[] = [
      { source: "prim_start", target: "prim_body", label: "", source_handle: null, target_handle: null, is_untaken: false },
      { source: "prim_body", target: "prim_end", label: "", source_handle: null, target_handle: null, is_untaken: false },
    ];

    // Function 2: main()
    const mainNodes: CFGNode[] = [
      { id: "main_start", type: "func_start", lines: [10], label: "main()", children: [], trace_indices: [3], is_untaken: false, func: "main" },
      { id: "main_body", type: "line", lines: [11], label: "line 11", children: [], trace_indices: [4], is_untaken: false, func: "main" },
      { id: "main_end", type: "func_end", lines: [12], label: "return", children: [], trace_indices: [5], is_untaken: false, func: "main" },
    ];
    const mainEdges: CFGEdge[] = [
      { source: "main_start", target: "main_body", label: "", source_handle: null, target_handle: null, is_untaken: false },
      { source: "main_body", target: "main_end", label: "", source_handle: null, target_handle: null, is_untaken: false },
    ];

    const allNodes = [...primNodes, ...mainNodes];
    const allEdges = [...primEdges, ...mainEdges];

    const { nodes } = layoutCFG(allNodes, allEdges, "prim_body");

    const primRendered = nodes.filter((n) => n.id.startsWith("prim_"));
    const mainRendered = nodes.filter((n) => n.id.startsWith("main_"));

    // Check that all prim nodes have right edge <= main nodes left edge (swimlane offset)
    const primMaxX = Math.max(...primRendered.map((n) => n.position.x + (n.initialWidth ?? 220)));
    const mainMinX = Math.min(...mainRendered.map((n) => n.position.x));

    assert.ok(
      mainMinX >= primMaxX + 100,
      `Expected mainMinX (${mainMinX}) to be at least 100px greater than primMaxX (${primMaxX}) with swimlane gap`,
    );

    // Check active state
    const activeNode = nodes.find((n) => n.id === "prim_body");
    assert.equal(activeNode?.data.isActive, true);
    const inactiveNode = nodes.find((n) => n.id === "main_body");
    assert.equal(inactiveNode?.data.isActive, false);
  });

  it("preserves loop-back target_handle and branch source_handles on edges", () => {
    invalidateLayoutCache();

    const nodes: CFGNode[] = [
      { id: "loop_1", type: "loop", lines: [10], label: "for (...)", children: [], trace_indices: [0], is_untaken: false },
      { id: "branch_2", type: "branch", lines: [11], label: "if (...)", children: [], trace_indices: [1], is_untaken: false },
      { id: "then_3", type: "line", lines: [12], label: "then", children: [], trace_indices: [2], is_untaken: false },
      { id: "else_4", type: "line", lines: [13], label: "else", children: [], trace_indices: [3], is_untaken: false },
    ];

    const edges: CFGEdge[] = [
      { source: "loop_1", target: "branch_2", label: "true", source_handle: "true", target_handle: null, is_untaken: false },
      { source: "branch_2", target: "then_3", label: "true", source_handle: "true", target_handle: null, is_untaken: false },
      { source: "branch_2", target: "else_4", label: "false", source_handle: "false", target_handle: null, is_untaken: false },
      { source: "then_3", target: "loop_1", label: "", source_handle: null, target_handle: "loop-back", is_untaken: false },
    ];

    const { edges: flowEdges } = layoutCFG(nodes, edges, null);

    const backEdge = flowEdges.find((e) => e.source === "then_3" && e.target === "loop_1");
    assert.ok(backEdge, "Loop back-edge must exist");
    assert.equal(backEdge?.targetHandle, "loop-back", "Back-edge must carry targetHandle='loop-back'");

    const branchTrue = flowEdges.find((e) => e.source === "branch_2" && e.target === "then_3");
    assert.equal(branchTrue?.sourceHandle, "true", "Branch true edge must carry sourceHandle='true'");

    const branchFalse = flowEdges.find((e) => e.source === "branch_2" && e.target === "else_4");
    assert.equal(branchFalse?.sourceHandle, "false", "Branch false edge must carry sourceHandle='false'");
  });

  it("ranks loop exit strictly below loop body leaves (no side-by-side ladder)", () => {
    invalidateLayoutCache();

    const nodes: CFGNode[] = [
      { id: "loop_1", type: "loop", lines: [8], label: "for (int u = 0; u < n; ++u)", children: [], trace_indices: [0], is_untaken: false },
      { id: "body_1", type: "line", lines: [9], label: "indeg[v]++", children: [], trace_indices: [1], is_untaken: false },
      { id: "exit_1", type: "line", lines: [11], label: "queue<int> q", children: [], trace_indices: [2], is_untaken: false },
    ];

    const edges: CFGEdge[] = [
      { source: "loop_1", target: "body_1", label: "true", source_handle: "true", target_handle: null, is_untaken: false },
      { source: "body_1", target: "loop_1", label: "", source_handle: null, target_handle: "loop-back", is_untaken: false },
      { source: "loop_1", target: "exit_1", label: "false", source_handle: "false", target_handle: null, is_untaken: false },
    ];

    const { nodes: positioned } = layoutCFG(nodes, edges, null);

    const loopNode = positioned.find((n) => n.id === "loop_1")!;
    const bodyNode = positioned.find((n) => n.id === "body_1")!;
    const exitNode = positioned.find((n) => n.id === "exit_1")!;

    // loopNode is at top
    assert.ok(bodyNode.position.y > loopNode.position.y, "body must be below loop header");
    // exitNode MUST be below bodyNode (not at the same rank side-by-side!)
    assert.ok(
      exitNode.position.y > bodyNode.position.y,
      `exitNode y (${exitNode.position.y}) must be strictly greater than bodyNode y (${bodyNode.position.y})`,
    );
  });

  it("defaults expandedNodeIds to include all loop nodes on loadCFG", async () => {
    const { useCFGStore } = await import("../src/store/cfgStore");
    const nodes: CFGNode[] = [
      { id: "loop_1", type: "loop", lines: [8], label: "for (...)", children: ["body_1"], trace_indices: [0], is_untaken: false },
      { id: "body_1", type: "line", lines: [9], label: "indeg[v]++", children: [], trace_indices: [1], is_untaken: false },
      { id: "loop_2", type: "loop", lines: [15], label: "while (...)", children: [], trace_indices: [2], is_untaken: false },
    ];
    useCFGStore.getState().loadCFG(nodes, []);
    const expanded = useCFGStore.getState().expandedNodeIds;
    assert.equal(expanded.has("loop_1"), true, "loop_1 should be expanded by default");
    assert.equal(expanded.has("loop_2"), true, "loop_2 should be expanded by default");
    assert.equal(expanded.size, 2);
  });

  it("places true branch target to the left of false branch target (matching left/right handles)", () => {
    invalidateLayoutCache();

    const nodes: CFGNode[] = [
      { id: "branch_1", type: "branch", lines: [5], label: "if (x > 0)", children: [], trace_indices: [0], is_untaken: false },
      { id: "then_1", type: "line", lines: [6], label: "then_stmt()", children: [], trace_indices: [1], is_untaken: false },
      { id: "else_1", type: "line", lines: [8], label: "else_stmt()", children: [], trace_indices: [2], is_untaken: false },
      { id: "merge_1", type: "line", lines: [10], label: "merge_stmt()", children: [], trace_indices: [3], is_untaken: false },
    ];

    const edges: CFGEdge[] = [
      { source: "branch_1", target: "then_1", label: "true", source_handle: "true", target_handle: null, is_untaken: false },
      { source: "branch_1", target: "else_1", label: "false", source_handle: "false", target_handle: null, is_untaken: false },
      { source: "then_1", target: "merge_1", label: "", source_handle: null, target_handle: null, is_untaken: false },
      { source: "else_1", target: "merge_1", label: "", source_handle: null, target_handle: null, is_untaken: false },
    ];

    const { nodes: positioned } = layoutCFG(nodes, edges, null);

    const thenNode = positioned.find((n) => n.id === "then_1")!;
    const elseNode = positioned.find((n) => n.id === "else_1")!;

    // thenNode (true target) MUST be to the left of elseNode (false target)
    // because true handle is at 30% and false handle is at 70%
    assert.ok(
      thenNode.position.x < elseNode.position.x,
      `Expected true target x (${thenNode.position.x}) < false target x (${elseNode.position.x}) to avoid crossed edges`,
    );
  });

  it("computes obstacle-avoidance waypoints for multi-rank loop exit edges", () => {
    invalidateLayoutCache();

    // Loop with 2 sequential body statements and an exit statement below
    const nodes: CFGNode[] = [
      { id: "loop_1", type: "loop", lines: [10], label: "for (int i = 0; i < n; ++i)", children: [], trace_indices: [0], is_untaken: false },
      { id: "body_1", type: "line", lines: [11], label: "step_one()", children: [], trace_indices: [1], is_untaken: false },
      { id: "body_2", type: "line", lines: [12], label: "step_two()", children: [], trace_indices: [2], is_untaken: false },
      { id: "exit_1", type: "line", lines: [14], label: "after_loop()", children: [], trace_indices: [3], is_untaken: false },
    ];

    const edges: CFGEdge[] = [
      { source: "loop_1", target: "body_1", label: "true", source_handle: "true", target_handle: null, is_untaken: false },
      { source: "body_1", target: "body_2", label: "", source_handle: null, target_handle: null, is_untaken: false },
      { source: "body_2", target: "loop_1", label: "", source_handle: null, target_handle: "loop-back", is_untaken: false },
      { source: "loop_1", target: "exit_1", label: "false", source_handle: "false", target_handle: null, is_untaken: false },
    ];

    const { edges: flowEdges } = layoutCFG(nodes, edges, null);

    const exitEdge = flowEdges.find((e) => e.source === "loop_1" && e.target === "exit_1");
    assert.ok(exitEdge, "Exit edge must exist");
    const points = (exitEdge?.data as { points?: { x: number; y: number }[] })?.points;
    assert.ok(points && points.length > 3, `Expected multi-rank exit edge to have >3 waypoints, got ${points?.length}`);
  });
});

