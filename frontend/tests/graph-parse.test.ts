/**
 * tests/graph-parse.test.ts — weighted adjacency entries survive parsing.
 *
 * Run: npx tsc tests/graph-parse.test.ts src/utils/graphParse.ts
 *   --outDir .tmp-graphtest --module es2022 --target es2022
 *   --moduleResolution bundler --skipLibCheck --strict --esModuleInterop \
 *   && node --test .tmp-graphtest/tests/graph-parse.test.js; rm -rf .tmp-graphtest
 *
 * Contract under test (see backend/app/core/instrumenter/tracer.h
 * __ser(vector<vector<T>>) + __ser(pair<T1,T2>)): a
 * vector<vector<pair<int,int>>> serializes as
 * {"_type":"graph","adj":[[[v,w],...],...]}. The visual must render one
 * directed edge per entry (10 for the prim preset, 5 undirected) with
 * weight labels — not drop every tuple via `typeof v !== "number"`.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeEdge,
  parseGraphValue,
  type AdjEntry,
  type GraphData,
} from "../src/utils/graphParse.js";

// Prim preset wire format: g[0]{(1,10),(2,6),(3,5)} g[1]{(0,10),(3,15)}
// g[2]{(0,6),(3,4)} g[3]{(0,5),(1,15),(2,4)}
const PRIM_ADJ: AdjEntry[][] = [
  [
    [1, 10],
    [2, 6],
    [3, 5],
  ],
  [
    [0, 10],
    [3, 15],
  ],
  [
    [0, 6],
    [3, 4],
  ],
  [
    [0, 5],
    [1, 15],
    [2, 4],
  ],
];

function requireData(value: unknown): GraphData {
  const data = parseGraphValue(value);
  if (!data) throw new Error("expected GraphData, got null");
  return data;
}

function directedEdgeCount(adj: AdjEntry[][]): number {
  let count = 0;
  for (const neighbors of adj) {
    for (const entry of neighbors) {
      if (normalizeEdge(entry) !== null) count++;
    }
  }
  return count;
}

function undirectedEdgeCount(adj: AdjEntry[][]): number {
  const seen = new Set<string>();
  adj.forEach((neighbors, u) => {
    for (const entry of neighbors) {
      const norm = normalizeEdge(entry);
      if (norm === null) continue;
      const a = Math.min(u, norm.v);
      const b = Math.max(u, norm.v);
      seen.add(`${a}-${b}`);
    }
  });
  return seen.size;
}

describe("normalizeEdge", () => {
  it("passes plain numbers through with no weight", () => {
    assert.deepEqual(normalizeEdge(2), { v: 2, weight: undefined });
  });

  it("extracts v + weight from [v,w] tuples", () => {
    assert.deepEqual(normalizeEdge([1, 10]), { v: 1, weight: 10 });
  });

  it("extracts v + weight from {first,second} (std::pair shape)", () => {
    assert.deepEqual(normalizeEdge({ first: 3, second: 5 }), {
      v: 3,
      weight: 5,
    });
  });

  it("extracts v + weight from {v,w} objects", () => {
    assert.deepEqual(normalizeEdge({ v: 0, w: 6 }), { v: 0, weight: 6 });
  });

  it("rejects garbage entries", () => {
    assert.equal(normalizeEdge(null), null);
    assert.equal(normalizeEdge(undefined), null);
    assert.equal(normalizeEdge("1"), null);
    assert.equal(normalizeEdge([1]), null);
    assert.equal(normalizeEdge({}), null);
  });
});

describe("parseGraphValue with weighted adjacency", () => {
  it("keeps tuple entries in a plain 2D array", () => {
    const data = requireData(PRIM_ADJ);
    assert.equal(directedEdgeCount(data.adj), 10);
    assert.equal(undirectedEdgeCount(data.adj), 5);
  });

  it("keeps tuple entries in an enriched {_type:'graph'} object", () => {
    const data = requireData({ _type: "graph", adj: PRIM_ADJ });
    assert.equal(directedEdgeCount(data.adj), 10);
    assert.equal(undirectedEdgeCount(data.adj), 5);
  });

  it("preserves weights end to end (0-1:10, 2-3:4)", () => {
    const data = requireData({ _type: "graph", adj: PRIM_ADJ });
    const w01 = normalizeEdge(data.adj[0][0]);
    const w23 = normalizeEdge(data.adj[2][1]);
    assert.deepEqual(w01, { v: 1, weight: 10 });
    assert.deepEqual(w23, { v: 3, weight: 4 });
  });

  it("still parses plain unweighted adjacency (regression)", () => {
    const data = requireData([
      [1, 2],
      [0, 3],
      [0],
      [1],
    ]);
    assert.equal(directedEdgeCount(data.adj), 6);
  });
});
