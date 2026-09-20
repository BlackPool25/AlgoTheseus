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
});
