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

import { useMemo } from "react";
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

// ── Constants ────────────────────────────────────────────────────────────────

const NODE_R = 20;
const NODE_D = NODE_R * 2;

/** Handle positions around the node — 8 points at 45° intervals */
const HANDLE_POSITIONS = [
  { id: "h0",  x: 0,      y: -NODE_R }, // top
  { id: "h1",  x: NODE_R * 0.707, y: -NODE_R * 0.707 }, // top-right
  { id: "h2",  x: NODE_R,  y: 0 },      // right
  { id: "h3",  x: NODE_R * 0.707, y: NODE_R * 0.707 },  // bottom-right
  { id: "h4",  x: 0,      y: NODE_R },  // bottom
  { id: "h5",  x: -NODE_R * 0.707, y: NODE_R * 0.707 }, // bottom-left
  { id: "h6",  x: -NODE_R, y: 0 },      // left
  { id: "h7",  x: -NODE_R * 0.707, y: -NODE_R * 0.707 }, // top-left
];

/** Pick the handle closest to the direction from source to target. */
function pickHandle(
  srcIdx: number,
  tgtIdx: number,
  positions: { x: number; y: number }[],
): string {
  const dx = positions[tgtIdx].x - positions[srcIdx].x;
  const dy = positions[tgtIdx].y - positions[srcIdx].y;
  const angle = Math.atan2(dy, dx); // -π .. π
  // Map angle to the nearest of 8 directions
  const step = (2 * Math.PI) / 8;
  const idx = Math.round((angle + Math.PI) / step) % 8;
  return HANDLE_POSITIONS[idx].id;
}

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
      {/* 8 directional handles — invisible, used for edge routing */}
      {HANDLE_POSITIONS.map((hp) => (
        <Handle
          key={hp.id}
          type="source"
          position={Position.Top}
          id={hp.id}
          style={{ top: hp.y + NODE_R, left: hp.x + NODE_R, opacity: 0, pointerEvents: "none" }}
        />
      ))}
      {HANDLE_POSITIONS.map((hp) => (
        <Handle
          key={`t-${hp.id}`}
          type="target"
          position={Position.Top}
          id={hp.id}
          style={{ top: hp.y + NODE_R, left: hp.x + NODE_R, opacity: 0, pointerEvents: "none" }}
        />
      ))}
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

// ── Main component ───────────────────────────────────────────────────────────

export function GraphAlgorithmVisual({ value, name }: Props) {
  const graphData = useMemo(() => parseGraphValue(value), [value]);

  const { nodes, edges } = useMemo(() => {
    if (!graphData) return { nodes: [], edges: [] };

    const { adj, state, distances, times, parent } = graphData;
    const n = adj.length;

    // Circular layout — radius scales with node count
    const radius = Math.max(120, Math.min(300, n * 22));
    const positions = circularLayout(n, radius);

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

    // Build edges — no dedup. Each edge routes through a handle pointing at its target.
    const flowEdges: Edge[] = [];

    for (let u = 0; u < n; u++) {
      const neighbors = adj[u];
      if (!neighbors) continue;
      for (const v of neighbors) {
        if (typeof v !== "number" || v < 0 || v >= n) continue;

        const kind = classifyEdge(u, v, parent, times);
        const arrow: { markerEnd: { type: MarkerType; color: string; width: number; height: number } } = {
          markerEnd: { type: MarkerType.ArrowClosed, color: edgeStyle(kind).stroke ?? "#a1a1aa", width: 16, height: 16 },
        };

        flowEdges.push({
          id: `e${u}-${v}`,
          source: `v${u}`,
          target: `v${v}`,
          type: "default",
          sourceHandle: pickHandle(u, v, positions),
          targetHandle: pickHandle(v, u, positions),
          style: edgeStyle(kind),
          ...arrow,
          label: kind !== "tree" ? kind : undefined,
          labelStyle: { fontSize: 9, fill: "#a1a1aa" },
          labelBgStyle: { fill: "#18181b", fontSize: 9 },
          animated: false,
        });
      }
    }

    return { nodes: flowNodes, edges: flowEdges };
  }, [graphData]);

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
        <div className="text-xs text-zinc-500">
          {name}: graph · {n} nodes · {edges.length} edges
        </div>
      )}
      <div className="border border-zinc-800 rounded-md overflow-hidden bg-zinc-900/50">
        <div style={{ height: 280, width: "100%" }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
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
