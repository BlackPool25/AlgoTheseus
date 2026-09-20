/**
 * tests/tree-overlap.test.ts — inorder-index tree layout overlap lock.
 *
 * Run (same convention as tree-routing.test.ts — no vitest in repo,
 * esbuild ships inside vite; run from frontend/):
 *   node node_modules/esbuild/bin/esbuild tests/tree-overlap.test.ts --bundle \
 *     --platform=node --format=cjs --jsx=automatic --loader:.css=empty \
 *     --define:import.meta.env='{}' \
 *     --outfile=/tmp/tree-overlap.test.cjs --log-level=error \
 *   && node --test /tmp/tree-overlap.test.cjs
 *
 * RED on pre-fix tree: buildTreeLayout used parent-relative offsets
 * (left = offset-1, right = offset+1), so the L→R path (40) and the R→L
 * path (60) in BST 50/30/70/20/40/60/80 landed on the same (x, y) and
 * painted over each other.
 *
 * GREEN: every node claims a unique inorder slot — all coordinates
 * distinct, x follows inorder, chains spread out, cycles still render ↩.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ROW_GAP,
  buildTreeLayout,
  flattenTree,
  type TreeInput,
  type TreePos,
} from "../src/utils/treeLayout";

interface BST {
  val: number;
  left: BST | null;
  right: BST | null;
}

function leaf(val: number): BST {
  return { val, left: null, right: null };
}

/** Reported repro: 50 with L30/R70, 30 with L20/R40, 70 with L60/R80. */
function bst7(): BST {
  return {
    val: 50,
    left: { val: 30, left: leaf(20), right: leaf(40) },
    right: { val: 70, left: leaf(60), right: leaf(80) },
  };
}

/** Degenerate right chain of 4. */
function rightChain(): BST {
  return {
    val: 1,
    left: null,
    right: {
      val: 2,
      left: null,
      right: { val: 3, left: null, right: leaf(4) },
    },
  };
}

function byLabel(nodes: { x: number; y: number; label: string }[], label: string) {
  const found = nodes.find((n) => n.label === label);
  assert.ok(found, `expected a node labeled ${label}`);
  return found;
}

function asTreeInput(v: unknown): TreeInput {
  return v as TreeInput;
}

describe("BST 50/30/70/20/40/60/80 — no overlap", () => {
  const root = buildTreeLayout(asTreeInput(bst7()));
  assert.ok(root, "root must lay out");
  const { nodes, edges } = flattenTree(root as TreePos);

  it("all 7 nodes have distinct (x, y) — 40 no longer hides under 60", () => {
    assert.equal(nodes.length, 7);
    const keys = new Set(nodes.map((n) => `${n.x},${n.y}`));
    assert.equal(keys.size, 7);
  });

  it("x follows inorder: 40 < 50 < 60 (and full inorder across the tree)", () => {
    const xs = (label: string): number => byLabel(nodes, label).x;
    assert.ok(xs("40") < xs("50"), "x(40) < x(50)");
    assert.ok(xs("50") < xs("60"), "x(50) < x(60)");
    for (const [a, b] of [["20", "30"], ["30", "40"], ["60", "70"], ["70", "80"]] as const) {
      assert.ok(xs(a) < xs(b), `x(${a}) < x(${b})`);
    }
  });

  it("y is depth * ROW_GAP; parent→child edges preserved", () => {
    assert.equal(byLabel(nodes, "50").y, 0);
    assert.equal(byLabel(nodes, "30").y, ROW_GAP);
    assert.equal(byLabel(nodes, "40").y, ROW_GAP * 2);
    assert.equal(edges.length, 6);
  });
});

describe("degenerate right chain of 4 — spreads out", () => {
  it("4 distinct positions with strictly increasing x", () => {
    const root = buildTreeLayout(asTreeInput(rightChain()));
    assert.ok(root, "root must lay out");
    const { nodes } = flattenTree(root as TreePos);
    assert.equal(nodes.length, 4);
    const keys = new Set(nodes.map((n) => `${n.x},${n.y}`));
    assert.equal(keys.size, 4);
    const xs = ["1", "2", "3", "4"].map((l) => byLabel(nodes, l).x);
    for (let i = 1; i < xs.length; i++) {
      assert.ok(xs[i - 1] as number < (xs[i] as number), `x strictly increases at index ${i}`);
    }
  });
});

describe("cycle + depth-limit contract preserved", () => {
  it("cycle node renders ↩ without hanging", () => {
    const root = buildTreeLayout(asTreeInput({ $cycle: true }));
    assert.ok(root, "cycle root must lay out");
    assert.equal((root as TreePos).label, "↩");
    assert.equal((root as TreePos).cycle, true);
  });

  it("cycle child renders ↩ alongside real siblings", () => {
    const root = buildTreeLayout(
      asTreeInput({ val: 1, left: asTreeInput({ $cycle: true }), right: leaf(2) }),
    );
    assert.ok(root, "root must lay out");
    const { nodes } = flattenTree(root as TreePos);
    assert.equal(nodes.length, 3);
    assert.ok(nodes.some((n) => n.label === "↩" && n.cycle));
  });

  it("$depth_limit subtrees are omitted", () => {
    const root = buildTreeLayout(
      asTreeInput({ val: 1, left: asTreeInput({ $depth_limit: true }), right: leaf(2) }),
    );
    assert.ok(root, "root must lay out");
    const { nodes } = flattenTree(root as TreePos);
    assert.equal(nodes.length, 2);
  });
});
