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

const NODE_WIDTH = 260;
const NODE_HEIGHT = 68;
const BRANCH_WIDTH = 270;
const FUNCTION_GAP = 160;

export interface EdgePoint {
  x: number;
  y: number;
}

export interface DagreLayoutResult {
  positions: Map<string, { x: number; y: number }>;
  edgePoints: Map<string, EdgePoint[]>;
}

/**
 * Module-level layout cache.
 * Key   = structural hash of node IDs + edge connectivity
 * Value = DagreLayoutResult — center positions and obstacle-avoidance edge points
 */
const layoutCache = new Map<string, DagreLayoutResult>();

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
    .map((e) => `${e.source}→${e.target}[${e.source_handle ?? ""}:${e.label ?? ""}]`)
    .sort()
    .join(",");
  return `${nodeIds}|${edgeKeys}`;
}

function getEdgeKey(e: CFGEdge): string {
  return `${e.source}->${e.target}[${e.source_handle ?? ""}:${e.label ?? ""}]`;
}

/**
 * Partition nodes and edges into weakly connected components (e.g. distinct functions).
 */
function partitionComponents(
  nodes: CFGNode[],
  edges: CFGEdge[],
): { nodes: CFGNode[]; edges: CFGEdge[] }[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of edges) {
    if (adj.has(e.source) && adj.has(e.target)) {
      adj.get(e.source)!.push(e.target);
      adj.get(e.target)!.push(e.source);
    }
  }

  const visited = new Set<string>();
  const components: { nodes: CFGNode[]; edges: CFGEdge[] }[] = [];

  for (const n of nodes) {
    if (visited.has(n.id)) continue;
    const compNodes: CFGNode[] = [];
    const queue: string[] = [n.id];
    visited.add(n.id);

    while (queue.length > 0) {
      const cur = queue.shift()!;
      const nodeObj = nodeMap.get(cur);
      if (nodeObj) compNodes.push(nodeObj);
      for (const neighbor of adj.get(cur) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    const compNodeIds = new Set(compNodes.map((cn) => cn.id));
    const compEdges = edges.filter(
      (e) => compNodeIds.has(e.source) && compNodeIds.has(e.target),
    );
    components.push({ nodes: compNodes, edges: compEdges });
  }

  return components;
}

/**
 * Run Dagre layout across connected components (swimlanes) so independent
 * functions (like `prim()` and `main()`) never overlap or collide horizontally.
 */
function runDagre(
  cfgNodes: CFGNode[],
  cfgEdges: CFGEdge[],
): DagreLayoutResult {
  const components = partitionComponents(cfgNodes, cfgEdges);
  const positions = new Map<string, { x: number; y: number }>();
  const edgePoints = new Map<string, EdgePoint[]>();
  let currentXOffset = 0;

  for (const comp of components) {
    const g = new dagre.graphlib.Graph({ multigraph: true });
    g.setDefaultEdgeLabel(() => ({}));
    g.setGraph({
      rankdir: "TB",
      nodesep: 45,
      ranksep: 65,
      edgesep: 25,
    });

    for (const n of comp.nodes) {
      const w = n.type === "branch" ? BRANCH_WIDTH : NODE_WIDTH;
      g.setNode(n.id, { width: w, height: NODE_HEIGHT });
    }

    // 1. Identify back-edges and loop leaves
    const backEdges = comp.edges.filter(
      (e) => e.target_handle === "loop-back",
    );
    const backEdgeSourcesByLoop = new Map<string, string[]>();
    for (const be of backEdges) {
      if (!backEdgeSourcesByLoop.has(be.target)) {
        backEdgeSourcesByLoop.set(be.target, []);
      }
      backEdgeSourcesByLoop.get(be.target)!.push(be.source);
    }

    // 2. Add forward edges to Dagre (EXCLUDE back-edges to keep the graph a strict DAG)
    const forwardEdges = comp.edges.filter((e) => e.target_handle !== "loop-back");
    // Sort forward edges: false edges come before true edges so Dagre orders true to the left and false to the right
    forwardEdges.sort((a, b) => {
      const getPriority = (e: CFGEdge) => {
        if (e.source_handle === "false" || e.label === "false") return 0;
        if (e.source_handle === "true" || e.label === "true") return 1;
        return 2;
      };
      return getPriority(a) - getPriority(b);
    });

    for (const e of forwardEdges) {
      // Sequential unlabelled edges get higher weight to stay vertically straight
      const weight = e.label ? 1 : 2;
      const edgeKey = getEdgeKey(e);
      g.setEdge(e.source, e.target, { weight }, edgeKey);
    }

    // 3. For each loop, add virtual ordering constraint from loop body leaves to exit node
    for (const n of comp.nodes) {
      if (n.type === "loop") {
        const falseEdge = comp.edges.find(
          (e) => e.source === n.id && (e.source_handle === "false" || e.label === "false"),
        );
        const loopLeaves = backEdgeSourcesByLoop.get(n.id) || [];
        if (falseEdge && loopLeaves.length > 0) {
          for (const leafId of loopLeaves) {
            // Virtual ordering edge: ensures the exit node is placed BELOW all loop body leaves
            g.setEdge(leafId, falseEdge.target, { minlen: 1, weight: 0 }, `__virtual__${leafId}->${falseEdge.target}`);
          }
        }
      }
    }

    dagre.layout(g);

    // Compute bounding box of this component including nodes and routing waypoints
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;

    for (const n of comp.nodes) {
      const nodeLayout = g.node(n.id);
      if (nodeLayout) {
        const w = n.type === "branch" ? BRANCH_WIDTH : NODE_WIDTH;
        minX = Math.min(minX, nodeLayout.x - w / 2);
        maxX = Math.max(maxX, nodeLayout.x + w / 2);
        minY = Math.min(minY, nodeLayout.y - NODE_HEIGHT / 2);
      }
    }

    for (const edgeObj of g.edges()) {
      const edgeLayout = g.edge(edgeObj);
      if (edgeLayout?.points) {
        for (const pt of edgeLayout.points) {
          minX = Math.min(minX, pt.x);
          maxX = Math.max(maxX, pt.x);
          minY = Math.min(minY, pt.y);
        }
      }
    }

    if (!Number.isFinite(minX)) {
      minX = 0;
      maxX = NODE_WIDTH;
      minY = 0;
    }

    // Place each node in the component with the horizontal swimlane offset
    for (const n of comp.nodes) {
      const nodeLayout = g.node(n.id);
      if (nodeLayout) {
        const localX = nodeLayout.x - minX;
        const localY = nodeLayout.y - minY;
        positions.set(n.id, {
          x: currentXOffset + localX,
          y: localY,
        });
      }
    }

    // Collect edge points transformed to world space
    for (const e of forwardEdges) {
      const edgeKey = getEdgeKey(e);
      const edgeLayout = g.edge(e.source, e.target, edgeKey);
      if (edgeLayout?.points && edgeLayout.points.length > 0) {
        const transformedPoints = edgeLayout.points.map((pt: { x: number; y: number }) => ({
          x: currentXOffset + (pt.x - minX),
          y: pt.y - minY,
        }));
        edgePoints.set(edgeKey, transformedPoints);
      }
    }

    const compWidth = Math.max(maxX - minX, NODE_WIDTH);
    currentXOffset += compWidth + FUNCTION_GAP;
  }

  return { positions, edgePoints };
}

export function layoutCFG(
  cfgNodes: CFGNode[],
  cfgEdges: CFGEdge[],
  activeId: string | null,
): { nodes: Node[]; edges: Edge[] } {
  // Compute cache key (structural identity only — activeId NOT included)
  const cacheKey = buildCacheKey(cfgNodes, cfgEdges);
  let layoutResult = layoutCache.get(cacheKey);

  if (!layoutResult) {
    // Cache miss — compute dagre layout and store for reuse
    layoutResult = runDagre(cfgNodes, cfgEdges);
    layoutCache.set(cacheKey, layoutResult);
  }

  const { positions, edgePoints } = layoutResult;

  // Convert cached positions to React Flow nodes with current activeId.
  const nodes: Node[] = cfgNodes.map((n) => {
    const pos = positions.get(n.id)!;
    const w = n.type === "branch" ? BRANCH_WIDTH : NODE_WIDTH;
    return {
      id: n.id,
      type: n.type,
      // Dagre gives center position; React Flow wants top-left
      position: { x: pos.x - w / 2, y: pos.y - NODE_HEIGHT / 2 },
      initialWidth: w,
      initialHeight: NODE_HEIGHT,
      data: {
        label: n.label,
        lines: n.lines,
        traceIndices: n.trace_indices,
        isActive: n.id === activeId,
        isUntaken: Boolean(n.is_untaken || (n.trace_indices && n.trace_indices.length === 0)),
        children: n.children,
        func: n.func,
        call_target: n.call_target,
      },
    };
  });

  // Convert edges with animated style for active path
  const edges: Edge[] = cfgEdges.map((e) => {
    const handle =
      e.source_handle ??
      (e.label === "true" ? "true" : e.label === "false" ? "false" : undefined);
    const edgeKey = getEdgeKey(e);
    const points = edgePoints.get(edgeKey);
    return {
      id: `${e.source}-${e.target}-${e.label || ""}`,
      source: e.source,
      target: e.target,
      sourceHandle: handle,
      targetHandle: e.target_handle ?? undefined,
      label: e.label || undefined,
      type: "trace", // our custom animated edge
      animated: false,
      style: { stroke: "var(--viz-panel-border)", strokeWidth: 1.5 },
      labelStyle: { fill: "var(--viz-alias-edge)", fontSize: 10 },
      labelBgStyle: { fill: "var(--viz-body-bg)" },
      data: {
        isUntaken: Boolean(e.is_untaken),
        points: points && points.length > 0 ? points : undefined,
      },
    };
  });

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
