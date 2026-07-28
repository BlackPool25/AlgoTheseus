/**
 * utils/cfgLayout.ts — Dagre-based layout for the CFG flowchart.
 *
 * Converts flat CFGNode/CFGEdge arrays into positioned React Flow nodes.
 * Uses @dagrejs/dagre for hierarchical top-down layout so branch nodes
 * visually fork and loop back-edges curve back up.
 *
 * CACHING:
 *   Positions are cached keyed by the structural identity of the graph
 *   (node IDs + edge source→target pairs). When only activeId changes
 *   (e.g. step scrubbing), the cached layout is reused and only the
 *   isActive flags are updated — avoiding expensive dagre recomputation.
 *
 *   The cache is transparent to consumers (TraceFlow.tsx etc.).
 *   Call invalidateLayoutCache() when the CFG structure actually changes
 *   (new data loaded, loop expand/collapse, etc.).
 *
 * Node sizing:
 *   - All nodes: 180px wide × 50px tall (compact for DSA programs)
 *   - Branch nodes: 200px wide (longer condition text)
 */

import dagre from "@dagrejs/dagre";
import type { Edge, Node } from "@xyflow/react";
import type { CFGEdge, CFGNode } from "../types/cfg";

const NODE_WIDTH = 180;
const NODE_HEIGHT = 50;
const BRANCH_WIDTH = 220;

/**
 * Module-level layout cache.
 * Key   = structural hash of node IDs + edge source→target pairs
 * Value = Map<nodeId, {x, y}> — Dagre-computed center positions
 */
const layoutCache = new Map<string, Map<string, { x: number; y: number }>>();

/**
 * Build a cache key that captures the structural identity of the graph.
 * Only node IDs and edge connectivity affect Dagre layout — labels,
 * activeId, trace indices, etc. are excluded.
 */
function buildCacheKey(cfgNodes: CFGNode[], cfgEdges: CFGEdge[]): string {
  const nodeIds = cfgNodes
    .map((n) => n.id)
    .sort()
    .join(",");
  const edgeKeys = cfgEdges
    .map((e) => `${e.source}→${e.target}`)
    .sort()
    .join(",");
  return `${nodeIds}|${edgeKeys}`;
}

/**
 * Run Dagre layout and return center-position results for each node.
 * Extracted so it can be skipped entirely on cache hit.
 */
function runDagre(
  cfgNodes: CFGNode[],
  cfgEdges: CFGEdge[],
): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: "TB", // top-to-bottom
    nodesep: 40, // horizontal gap between nodes at same rank
    ranksep: 60, // vertical gap between ranks
    edgesep: 20,
  });

  for (const n of cfgNodes) {
    const w = n.type === "branch" ? BRANCH_WIDTH : NODE_WIDTH;
    g.setNode(n.id, { width: w, height: NODE_HEIGHT });
  }

  for (const e of cfgEdges) {
    g.setEdge(e.source, e.target);
  }

  dagre.layout(g);
  console.count("dagre layout");

  const positions = new Map<string, { x: number; y: number }>();
  for (const n of cfgNodes) {
    positions.set(n.id, g.node(n.id));
  }
  return positions;
}

export function layoutCFG(
  cfgNodes: CFGNode[],
  cfgEdges: CFGEdge[],
  activeId: string | null,
): { nodes: Node[]; edges: Edge[] } {
  // Compute cache key (structural identity only — activeId NOT included)
  const cacheKey = buildCacheKey(cfgNodes, cfgEdges);
  let positions = layoutCache.get(cacheKey);

  if (!positions) {
    // Cache miss — compute dagre layout and store for reuse
    positions = runDagre(cfgNodes, cfgEdges);
    layoutCache.set(cacheKey, positions);
  }

  // Convert cached positions to React Flow nodes with current activeId.
  // Node data (label, lines, etc.) is always fresh from cfgNodes — only the
  // x/y positions are reused from cache.
  const nodes: Node[] = cfgNodes.map((n) => {
    const pos = positions!.get(n.id)!;
    const w = n.type === "branch" ? BRANCH_WIDTH : NODE_WIDTH;
    return {
      id: n.id,
      type: n.type,
      // Dagre gives center position; React Flow wants top-left
      position: { x: pos.x - w / 2, y: pos.y - NODE_HEIGHT / 2 },
      data: {
        label: n.label,
        lines: n.lines,
        traceIndices: n.trace_indices,
        isActive: n.id === activeId,
        children: n.children,
      },
    };
  });

  // Convert edges with animated style for active path
  const edges: Edge[] = cfgEdges.map((e) => ({
    id: `${e.source}-${e.target}`,
    source: e.source,
    target: e.target,
    label: e.label || undefined,
    type: "trace", // our custom animated edge
    animated: false,
    style: { stroke: "#52525b", strokeWidth: 1.5 },
    labelStyle: { fill: "#a1a1aa", fontSize: 10 },
    labelBgStyle: { fill: "#18181b" },
  }));

  return { nodes, edges };
}

/**
 * Clear the layout cache.
 *
 * Call this when the CFG structure actually changes — new trace data loaded,
 * loop expand/collapse toggling visibility of different node sets — so the
 * next call to layoutCFG recomputes positions from scratch.
 *
 * Does NOT need to be called on step scrub (activeId change) — that's the
 * whole point of the cache.
 */
export function invalidateLayoutCache(): void {
  layoutCache.clear();
}
