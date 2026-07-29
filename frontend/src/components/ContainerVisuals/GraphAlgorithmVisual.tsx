/**
 * components/ContainerVisuals/GraphAlgorithmVisual.tsx — Graph algorithm visualization.
 *
 * Renders BFS/DFS/Dijkstra/MST traces as an interactive React Flow graph.
 * Nodes are circles colored by visitation state; edges are labeled by type
 * (tree/back/cross) with distinct stroke patterns.
 *
 * Input shapes (both detected automatically):
 *   1. Plain adjacency list:  [[1,2],[0,3],[0],[1]]
 *   2. Enriched object:       { _type:"graph", adj:[[1,2],...], state:[...], dist:[...] }
 *
 * Layout: circular (equal radius) — works for undirected and directed graphs.
 */

import { useMemo, useState } from "react";
import {
  Background,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { GraphEdge } from "./GraphEdge";

// ── Constants ────────────────────────────────────────────────────────────────

const NODE_R = 20;
const NODE_D = NODE_R * 2;

// Center-to-center edge routing via custom GraphEdge component.
// No manual handle picking needed — React Flow computes sourceX/sourceY
// from the single hidden handle, and GraphEdge clips at NODE_R.

type NodeState = 0 | 1 | 2 | 3;

const STATE_BORDER: Record<NodeState, string> = {
  0: "#71717a", // unvisited – zinc-500
  1: "#3b82f6", // queued    – blue-500
  2: "#f59e0b", // processing – amber-500
  3: "#22c55e", // processed  – green-500
};

const STATE_FILL: Record<NodeState, string> = {
  0: "#3f3f46", // zinc-700
  1: "#1e3a5f", // blue-900
  2: "#451a03", // amber-900
  3: "#052e16", // green-900
};

// ── Types ────────────────────────────────────────────────────────────────────

interface GraphData {
  adj: number[][];
  state?: number[];
  distances?: (number | null)[];
  times?: { disc: number; fin?: number }[];
  parent?: (number | null)[];
}

interface Props {
  value: unknown;
  name?: string;
}

type EdgeKind = "tree" | "back" | "cross" | "forward";

// ── Input parsing ────────────────────────────────────────────────────────────

function parseGraphValue(value: unknown): GraphData | null {
  if (!value) return null;

  // 2D array → plain adjacency list
  if (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => Array.isArray(item))
  ) {
    return { adj: value as number[][] };
  }

  // Enriched object with _type discriminator
  if (typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (
      (obj._type === "graph" || obj.adj !== undefined) &&
      Array.isArray(obj.adj)
    ) {
      return {
        adj: obj.adj as number[][],
        state: Array.isArray(obj.state) ? (obj.state as number[]) : undefined,
        distances: Array.isArray(obj.dist)
          ? (obj.dist as (number | null)[])
          : undefined,
        times: Array.isArray(obj.times)
          ? (obj.times as { disc: number; fin?: number }[])
          : undefined,
        parent: Array.isArray(obj.parent)
          ? (obj.parent as (number | null)[])
          : undefined,
      };
    }
  }

  return null;
}

// ── Layout ───────────────────────────────────────────────────────────────────

function circularLayout(
  n: number,
  radius: number,
): { x: number; y: number }[] {
  if (n === 0) return [];
  if (n === 1) return [{ x: 0, y: 0 }];

  const positions: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2;
    positions.push({
      x: radius * Math.cos(angle),
      y: radius * Math.sin(angle),
    });
  }
  return positions;
}

function forceLayout(
  n: number,
  adj: number[][],
): { x: number; y: number }[] {
  const positions = Array.from({ length: n }, (_, i) => ({
    x: Math.cos((2 * Math.PI * i) / n) * 100,
    y: Math.sin((2 * Math.PI * i) / n) * 100,
  }));
  const velocity = positions.map(() => ({ x: 0, y: 0 }));
  const W = 400, H = 400;
  const REPULSION = 5000;
  const ATTRACTION = 0.005;
  const DAMPING = 0.85;
  const ITERATIONS = 100;

  for (let iter = 0; iter < ITERATIONS; iter++) {
    // Repulsion between all pairs
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = positions[j].x - positions[i].x;
        const dy = positions[j].y - positions[i].y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = REPULSION / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        velocity[i].x -= fx;
        velocity[i].y -= fy;
        velocity[j].x += fx;
        velocity[j].y += fy;
      }
    }
    // Attraction along edges
    for (let u = 0; u < n; u++) {
      for (const v of adj[u]) {
        if (v <= u) continue;
        const dx = positions[v].x - positions[u].x;
        const dy = positions[v].y - positions[u].y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = ATTRACTION * dist;
        velocity[u].x += (dx / dist) * force;
        velocity[u].y += (dy / dist) * force;
        velocity[v].x -= (dx / dist) * force;
        velocity[v].y -= (dy / dist) * force;
      }
    }
    // Center gravity
    for (let i = 0; i < n; i++) {
      velocity[i].x += (W / 2 - positions[i].x) * 0.001;
      velocity[i].y += (H / 2 - positions[i].y) * 0.001;
    }
    // Apply velocity with damping
    for (let i = 0; i < n; i++) {
      velocity[i].x *= DAMPING;
      velocity[i].y *= DAMPING;
      positions[i].x += velocity[i].x;
      positions[i].y += velocity[i].y;
    }
  }
  return positions;
}

// ── Edge classification ──────────────────────────────────────────────────────

function classifyEdge(
  u: number,
  v: number,
  parent: (number | null)[] | undefined,
  times: { disc: number; fin?: number }[] | undefined,
): EdgeKind {
  if (parent) {
    if (parent[v] === u) return "tree";
    if (parent[u] === v) return "tree";
  }

  if (times && times[u] && times[v]) {
    const tu = times[u];
    const tv = times[v];
    if (tv.disc > tu.disc && (!tu.fin || tv.disc < tu.fin)) return "tree";
    if (tu.disc > tv.disc && (!tv.fin || tu.disc < tv.fin)) return "back";
    if (tu.fin && tv.disc > tu.fin) return "cross";
    return "forward";
  }

  return "tree";
}

function edgeStyle(kind: EdgeKind): React.CSSProperties {
  switch (kind) {
    case "back":
      return { stroke: "#ef4444", strokeWidth: 2, strokeDasharray: "6,4" };
    case "cross":
      return { stroke: "#71717a", strokeWidth: 1.5, strokeDasharray: "3,3" };
    case "forward":
      return { stroke: "#a1a1aa", strokeWidth: 1.5, strokeDasharray: "4,2" };
    default:
      return { stroke: "#a1a1aa", strokeWidth: 2 };
  }
}

// ── Custom node component ────────────────────────────────────────────────────

function GraphNode({ data }: NodeProps) {
  return (
    <div
      className="flex flex-col items-center justify-center rounded-full border-2 leading-none"
      style={{
        width: NODE_D,
        height: NODE_D,
        background: (data as Record<string, unknown>).fill as string,
        borderColor: (data as Record<string, unknown>).color as string,
      }}
    >
      {/* Single hidden handle — exists only so React Flow can compute
          sourceX/sourceY/targetX/targetY for the custom edge. */}
      <Handle
        type="source"
        position={Position.Top}
        id="center"
        style={{ opacity: 0, pointerEvents: "none" }}
      />
      <Handle
        type="target"
        position={Position.Top}
        id="center"
        style={{ opacity: 0, pointerEvents: "none" }}
      />
      <span className="text-[11px] font-mono font-bold text-white pointer-events-none">
        {data.label as string}
      </span>
      {(data as Record<string, unknown>).annotation ? (
        <span className="text-[8px] font-mono text-white/70 pointer-events-none">
          {(data as Record<string, unknown>).annotation as string}
        </span>
      ) : null}
    </div>
  );
}

const NODE_TYPES = { graphNode: GraphNode };
const EDGE_TYPES = { graphEdge: GraphEdge };

// ── Main component ───────────────────────────────────────────────────────────

export function GraphAlgorithmVisual({ value, name }: Props) {
  const graphData = useMemo(() => parseGraphValue(value), [value]);

  const hasParent = !!(graphData?.parent && graphData.parent.length > 0);
  const [useForce, setUseForce] = useState(false);
  const effectiveUseForce = hasParent ? !useForce : useForce;

  const { nodes, edges } = useMemo(() => {
    if (!graphData) return { nodes: [], edges: [] };

    const { adj, state, distances, times, parent } = graphData;
    const n = adj.length;

    // Layout — auto-detect: if parent array exists (tree structure from DFS/BFS/MST/Dijkstra),
    // prefer force-directed layout. Toggle button overrides the auto-detection.
    const radius = Math.max(120, Math.min(300, n * 22));
    const positions = effectiveUseForce
      ? forceLayout(n, adj)
      : circularLayout(n, radius);

    // Build React Flow nodes
    const flowNodes: Node[] = positions.map((pos, i) => {
      const s = (state?.[i] ?? 0) as NodeState;
      const color = STATE_BORDER[s];
      const fill = STATE_FILL[s];

      let annotation = "";
      if (distances && distances[i] !== null && distances[i] !== undefined) {
        annotation = `d=${distances[i]}`;
      } else if (times && times[i]) {
        const t = times[i];
        annotation = t.fin !== undefined ? `${t.disc}/${t.fin}` : `${t.disc}/–`;
      }

      return {
        id: `v${i}`,
        type: "graphNode",
        position: { x: pos.x - NODE_R, y: pos.y - NODE_R },
        data: {
          label: String(i),
          annotation,
          color,
          fill,
        },
        style: { width: NODE_D, height: NODE_D },
      };
    });

    // Build edges — center-to-center routing via custom graphEdge type.
    // React Flow computes sourceX/sourceY/targetX/targetY from the single
    // hidden handle; GraphEdge clips the line at NODE_R from each center.
    const flowEdges: Edge[] = [];

    for (let u = 0; u < n; u++) {
      const neighbors = adj[u];
      if (!neighbors) continue;
      for (const v of neighbors) {
        if (typeof v !== "number" || v < 0 || v >= n) continue;

        const kind = classifyEdge(u, v, parent, times);

        flowEdges.push({
          id: `e${u}-${v}`,
          source: `v${u}`,
          target: `v${v}`,
          type: "graphEdge",
          style: edgeStyle(kind),
          markerEnd: { type: MarkerType.ArrowClosed as const, color: edgeStyle(kind).stroke ?? "#a1a1aa", width: 14, height: 14 },
          label: kind !== "tree" ? kind : undefined,
          labelStyle: { fontSize: 9, fill: "#a1a1aa" },
          labelBgStyle: { fill: "#18181b", fontSize: 9 },
          animated: false,
        });
      }
    }

    return { nodes: flowNodes, edges: flowEdges };
  }, [graphData, effectiveUseForce]);

  if (!graphData) return null;

  const n = graphData.adj.length;
  if (n === 0) {
    return (
      <div className="flex flex-col gap-1">
        {name && <div className="text-xs text-zinc-500">{name}: graph</div>}
        <span className="text-[10px] text-zinc-600 italic">empty graph</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {name && (
        <div className="text-xs text-zinc-500 flex items-center gap-2">
          <span>{name}: graph · {n} nodes · {edges.length} edges</span>
          <button
            onClick={() => setUseForce(!useForce)}
            className="underline decoration-dotted underline-offset-2 hover:text-zinc-300"
          >
            {effectiveUseForce ? "circular" : "force-directed"}
          </button>
        </div>
      )}
      <div className="border border-zinc-800 rounded-md overflow-hidden bg-zinc-900/50">
        <div style={{ height: 280, width: "100%" }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            edgeTypes={EDGE_TYPES}
            minZoom={0.25}
            maxZoom={4}
            fitView
            fitViewOptions={{ padding: 0.15 }}
            proOptions={{ hideAttribution: true }}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
          >
            <Background color="#27272a" gap={16} />
          </ReactFlow>
        </div>
      </div>
    </div>
  );
}
