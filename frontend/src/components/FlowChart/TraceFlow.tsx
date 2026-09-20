/**
 * components/FlowChart/TraceFlow.tsx — React Flow root component.
 *
 * Converts CFGNode/CFGEdge from cfgStore into React Flow nodes/edges.
 * Uses Dagre layout for proper branching structure.
 * Highlights the active node and edge based on traceStore.currentStep.
 * Supports loop expand/collapse via cfgStore.expandedNodeIds.
 */

import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Crosshair, Target, Maximize2 } from "lucide-react";
import { useCFGStore } from "../../store/cfgStore";
import { useTraceStore } from "../../store/traceStore";
import type { CFGNode } from "../../types/cfg";
import type { TraceEvent } from "../../types/trace";
import { layoutCFG } from "../../utils/cfgLayout";
import {
  FLOW_FIT_PADDING,
  FLOW_REFIT_DEBOUNCE_MS,
  shouldAutoRefit,
  visibleFitKey,
} from "../../utils/flowViewport";
import { TraceEdge } from "./edges/TraceEdge";
import { BranchNode } from "./nodes/BranchNode";
import { LineNode } from "./nodes/LineNode";
import { LoopNode } from "./nodes/LoopNode";
import { RecursionTreeNode } from "./nodes/RecursionTreeNode";

const NODE_TYPES = {
  line:       LineNode,
  branch:     BranchNode,
  loop:       LoopNode,
  func_start: LineNode,
  func_end:   LineNode,
  func_call:  RecursionTreeNode,
};

const EDGE_TYPES = {
  trace: TraceEdge,
};

/**
 * Filter nodes for loop expand/collapse.
 * When a loop node is collapsed, hide its child nodes.
 * When expanded, show them.
 */
function filterForExpansion(
  cfgNodes: CFGNode[],
  expandedNodeIds: Set<string>
): CFGNode[] {
  // Build set of hidden node IDs (children of collapsed loop nodes)
  const hiddenIds = new Set<string>();

  for (const node of cfgNodes) {
    if (node.type === "loop" && !expandedNodeIds.has(node.id)) {
      for (const childId of node.children) {
        hiddenIds.add(childId);
      }
    }
  }

  return cfgNodes.filter((n) => !hiddenIds.has(n.id));
}

/**
 * First scalar (or first) `k = v` assignment from a vars record, compacted
 * for node width. Null when the record is empty.
 */
function scalarAssignment(vars: Record<string, unknown>): string | null {
  const entries = Object.entries(vars);
  if (entries.length === 0) return null;
  const scalar = entries.find(
    ([, v]) => typeof v === "number" || typeof v === "string" || typeof v === "boolean",
  );
  const [k, v] = scalar ?? entries[0];
  const vs = typeof v === "string" ? v : (JSON.stringify(v) ?? String(v));
  const short = vs.length > 24 ? `${vs.slice(0, 24)}…` : vs;
  return `${k} = ${short}`;
}

function shortValue(v: unknown): string {
  const s = typeof v === "string" ? v : (JSON.stringify(v) ?? String(v));
  return s.length > 24 ? `${s.slice(0, 24)}…` : s;
}

/**
 * Enrich a CFG node label with an explicit `variable = value` suffix drawn
 * from the trace payload at the node's first trace index (no backend
 * change). Labels that already carry `=` (e.g. `arr[mid] == target`) pass
 * through; bare labels (`body`, `found`, `→ 3`) gain a truthful suffix so
 * no node ever reads as a bare value.
 */
function enrichNodeLabel(node: CFGNode, trace: TraceEvent[]): string {
  const base = node.label;
  if (base.includes("=")) return base;
  const idx = node.trace_indices?.[0];
  const rep = idx != null ? trace[idx] : undefined;
  if (!rep) return base;
  const desc =
    typeof (rep as { step_desc?: unknown }).step_desc === "string"
      ? (rep as { step_desc: string }).step_desc
      : null;
  if (desc && desc.includes("=")) return `${base} · ${desc}`;
  switch (rep.type) {
    case "state": {
      const a = scalarAssignment(rep.vars);
      return a ? `${base} · ${a}` : `${base} · step = ${idx + 1}`;
    }
    case "enter": {
      const a = scalarAssignment(rep.params);
      return a ? `${base} · ${a}` : `${base} · step = ${idx + 1}`;
    }
    case "exit":
      return `${base} · return = ${shortValue(rep.return_val)}`;
    case "branch":
      return `${base} · taken = ${rep.taken ? "true" : "false"}`;
    case "iter":
      return `${base} · iter = ${rep.iteration}`;
    default:
      return base;
  }
}

/**
 * Inner component rendered inside <ReactFlow> so useReactFlow() is available.
 * Handles initial fitView on CFG load and smooth pan-to-active on step change.
 */
function FlowViewController({
  containerRef,
  cfgNodes,
  currentStep,
  activeId,
  flowNodes,
  autoFollow,
  onToggleAutoFollow,
  userMovedRef,
  expandedCount,
}: {
  containerRef: { readonly current: HTMLDivElement | null };
  cfgNodes: CFGNode[];
  currentStep: number;
  activeId: string | null;
  flowNodes: Node[];
  autoFollow: boolean;
  onToggleAutoFollow: () => void;
  /** Set by <ReactFlow onMoveStart> on user pan/zoom; suppresses auto re-fit. */
  userMovedRef: { current: boolean };
  /** expandedNodeIds.size — part of the re-fit key so expand/collapse re-fits. */
  expandedCount: number;
}) {
  const { fitView, setCenter, getViewport } = useReactFlow();
  const initialFitDone = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sizeRef = useRef<{ width: number; height: number } | null>(null);

  // Fresh CFG load (new nodes array identity): forget the user's old viewport
  // gesture so the new graph fits. Declared before the fit effect so it runs
  // first on the same commit.
  useEffect(() => {
    userMovedRef.current = false;
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    sizeRef.current = null;
    initialFitDone.current = false;
  }, [cfgNodes, userMovedRef]);

  // Initial fit on CFG load + re-fit when expand/collapse reveals nodes
  // (flowNodes.length tracks VISIBLE nodes; store cfgNodes.length does not).
  // Never steals the camera after the user manually positioned the view.
  const fitKey = visibleFitKey(flowNodes.length, expandedCount);
  useEffect(() => {
    if (cfgNodes.length > 0 && !initialFitDone.current) {
      fitView({ padding: FLOW_FIT_PADDING, duration: 250 });
      initialFitDone.current = true;
    } else if (
      cfgNodes.length > 0 &&
      initialFitDone.current &&
      !userMovedRef.current
    ) {
      fitView({ padding: FLOW_FIT_PADDING });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fitKey is the
    // derived dep; userMovedRef is a stable ref whose .current is read.
  }, [cfgNodes.length, fitKey, fitView]);

  // Re-fit when the flow container's pixel size changes (resizable columns,
  // window resize) unless the user manually positioned the view. Debounced so
  // panel-drag resizing doesn't refit 60x/sec. Refs only — no setState.
  useEffect(() => {
    const el = containerRef.current;
    if (el === null || typeof ResizeObserver === "undefined") return;
    // Baseline without fitting: avoids an immediate refit on mount (the fit
    // effect above owns the initial fit) and on every fresh observer attach.
    sizeRef.current = { width: el.clientWidth, height: el.clientHeight };
    const ro = new ResizeObserver(() => {
      const width = el.clientWidth;
      const height = el.clientHeight;
      const prev = sizeRef.current;
      const decision = shouldAutoRefit({
        userMoved: userMovedRef.current,
        width,
        height,
        prevWidth: prev?.width ?? width,
        prevHeight: prev?.height ?? height,
      });
      sizeRef.current = { width, height };
      if (!decision) return;
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
      }
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        // Re-check at fire time: the user may have grabbed the view or the
        // panel may have been hidden mid-drag.
        if (
          !userMovedRef.current &&
          el.clientWidth > 0 &&
          el.clientHeight > 0
        ) {
          fitView({ padding: FLOW_FIT_PADDING });
        }
      }, FLOW_REFIT_DEBOUNCE_MS);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [containerRef, fitView, userMovedRef]);

  const centerOnNode = useCallback(
    (nodeId: string, duration = 350) => {
      const node = flowNodes.find((n) => n.id === nodeId);
      if (!node) return;
      const viewport = getViewport();
      const cx = node.position.x + (node.measured?.width ?? 120) / 2;
      const cy = node.position.y + (node.measured?.height ?? 50) / 2;
      setCenter(cx, cy, {
        zoom: Math.min(Math.max(viewport.zoom, 0.7), 1.2),
        duration,
      });
    },
    [flowNodes, getViewport, setCenter],
  );

  // On step change: smooth-pan to active node (when autoFollow is enabled and node moves off-screen)
  useEffect(() => {
    if (!autoFollow || !activeId) return;

    const node = flowNodes.find((n) => n.id === activeId);
    if (!node) return;

    const viewport = getViewport();
    const el = containerRef.current;
    if (!el) return;

    const width = el.clientWidth;
    const height = el.clientHeight;
    const MARGIN = 100;

    const sx = node.position.x * viewport.zoom + viewport.x;
    const sy = node.position.y * viewport.zoom + viewport.y;

    const isOffScreen =
      sx < -MARGIN ||
      sx > width + MARGIN ||
      sy < -MARGIN ||
      sy > height + MARGIN;

    if (isOffScreen) {
      centerOnNode(activeId, 250);
    }
  }, [currentStep, autoFollow, activeId, centerOnNode, flowNodes, containerRef, getViewport]);

  return (
    <div className="absolute top-2.5 left-2.5 z-20 flex items-center gap-1 bg-viz-panel/90 backdrop-blur-xs border border-viz-line rounded-lg p-1 shadow-md text-xs select-none">
      <button
        onClick={onToggleAutoFollow}
        className={`flex items-center gap-1 px-2 py-1 rounded transition-colors ${
          autoFollow
            ? "bg-amber-500/20 text-amber-400 font-medium"
            : "text-viz-ink/60 hover:text-viz-ink"
        }`}
        title={
          autoFollow
            ? "Auto-follow camera: ON (click to unlock camera)"
            : "Auto-follow camera: OFF (click to lock camera)"
        }
      >
        <Crosshair className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Follow</span>
      </button>

      {activeId && (
        <button
          onClick={() => centerOnNode(activeId, 350)}
          className="flex items-center gap-1 px-2 py-1 rounded text-viz-ink/70 hover:text-viz-ink hover:bg-viz-body/60 transition-colors"
          title="Center view on current step"
        >
          <Target className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Snap</span>
        </button>
      )}

      <button
        onClick={() => fitView({ padding: 0.2, duration: 300 })}
        className="flex items-center gap-1 px-2 py-1 rounded text-viz-ink/70 hover:text-viz-ink hover:bg-viz-body/60 transition-colors"
        title="Fit whole graph in view"
      >
        <Maximize2 className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Fit</span>
      </button>
    </div>
  );
}

export function TraceFlow() {
  const [autoFollow, setAutoFollow] = useState(false);
  const cfgNodes = useCFGStore((s) => s.nodes);
  const cfgEdges = useCFGStore((s) => s.edges);
  const activeNodeId = useCFGStore((s) => s.activeNodeId);
  const expandedNodeIds = useCFGStore((s) => s.expandedNodeIds);
  const currentStep = useTraceStore((s) => s.currentStep);
  const trace = useTraceStore((s) => s.trace);
  const containerRef = useRef<HTMLDivElement>(null);
  // True once the user manually pans/zooms (onMoveStart). Resets on CFG load.
  const userMovedRef = useRef(false);
  const handleMoveStart = useCallback(() => {
    userMovedRef.current = true;
  }, []);

  // Derive active node from current step
  const activeId = useMemo(() => {
    const node = cfgNodes.find((n) => (n.trace_indices ?? []).includes(currentStep));
    return node?.id ?? activeNodeId;
  }, [cfgNodes, currentStep, activeNodeId]);

  // Filter nodes based on expand/collapse state
  const visibleNodes = useMemo(
    () => filterForExpansion(cfgNodes, expandedNodeIds),
    [cfgNodes, expandedNodeIds]
  );

  // Filter edges to only include edges between visible nodes
  const visibleNodeIds = useMemo(
    () => new Set(visibleNodes.map((n) => n.id)),
    [visibleNodes]
  );

  const visibleEdges = useMemo(() => {
    // Rebuild the hidden set (same rule as filterForExpansion) so edges
    // orphaned by collapsed loops can be rewired through hidden children.
    const hiddenIds = new Set<string>();
    for (const node of cfgNodes) {
      if (node.type === "loop" && !expandedNodeIds.has(node.id)) {
        for (const childId of node.children) {
          hiddenIds.add(childId);
        }
      }
    }

    const successors = new Map<string, string[]>();
    const predecessors = new Map<string, string[]>();
    for (const e of cfgEdges) {
      const s = successors.get(e.source);
      if (s) s.push(e.target);
      else successors.set(e.source, [e.target]);
      const p = predecessors.get(e.target);
      if (p) p.push(e.source);
      else predecessors.set(e.target, [e.source]);
    }

    // Walk forward through hidden nodes to the nearest visible successor(s).
    const forwardVisible = (startHidden: string): string[] => {
      const found: string[] = [];
      const seen = new Set<string>([startHidden]);
      const stack: string[] = [startHidden];
      while (stack.length > 0) {
        const cur = stack.pop() as string;
        if (!hiddenIds.has(cur)) {
          if (visibleNodeIds.has(cur)) found.push(cur);
          continue;
        }
        for (const next of successors.get(cur) ?? []) {
          if (!seen.has(next)) {
            seen.add(next);
            stack.push(next);
          }
        }
      }
      return found;
    };

    // Walk back through hidden nodes to the nearest visible ancestor(s).
    const backVisible = (startHidden: string): string[] => {
      const found: string[] = [];
      const seen = new Set<string>([startHidden]);
      const stack: string[] = [startHidden];
      while (stack.length > 0) {
        const cur = stack.pop() as string;
        if (!hiddenIds.has(cur)) {
          if (visibleNodeIds.has(cur)) found.push(cur);
          continue;
        }
        for (const prev of predecessors.get(cur) ?? []) {
          if (!seen.has(prev)) {
            seen.add(prev);
            stack.push(prev);
          }
        }
      }
      return found;
    };

    const out: typeof cfgEdges = [];
    const seenEdge = new Set<string>();
    const pushEdge = (source: string, target: string, label: string): void => {
      if (source === target) return;
      const key = `${source}|${target}`;
      if (seenEdge.has(key)) return;
      seenEdge.add(key);
      out.push({ source, target, label });
    };

    // Keep original visible-direct edges unchanged (they win dedupe).
    for (const e of cfgEdges) {
      if (visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target)) {
        pushEdge(e.source, e.target, e.label);
      }
    }

    // Bypass hidden chains: visible -> hidden... -> visible.
    for (const e of cfgEdges) {
      if (visibleNodeIds.has(e.source) && hiddenIds.has(e.target)) {
        for (const succ of forwardVisible(e.target)) {
          pushEdge(e.source, succ, e.label);
        }
      } else if (hiddenIds.has(e.source) && visibleNodeIds.has(e.target)) {
        for (const anc of backVisible(e.source)) {
          pushEdge(anc, e.target, e.label);
        }
      }
    }

    return out;
  }, [cfgEdges, visibleNodeIds, cfgNodes, expandedNodeIds]);

  // Apply Dagre layout
  const { nodes: flowNodes, edges: flowEdges } = useMemo(() => {
    if (visibleNodes.length === 0) return { nodes: [], edges: [] };
    const { nodes, edges } = layoutCFG(visibleNodes, visibleEdges, activeId);

    // Mark active node
    const nodesWithActive = nodes.map((n) => ({
      ...n,
      data: {
        ...n.data,
        label: enrichNodeLabel(
          visibleNodes.find((c) => c.id === n.id) ?? {
            id: n.id,
            type: "line",
            lines: [],
            label: String((n.data as { label?: unknown }).label ?? ""),
            children: [],
            trace_indices: [],
          },
          trace,
        ),
        isActive: n.id === activeId,
      },
    }));

    // Determine previous active node to illuminate the exact traversed edge
    const prevNode =
      currentStep > 0
        ? visibleNodes.find((n) => (n.trace_indices ?? []).includes(currentStep - 1))
        : null;
    const prevActiveId = prevNode?.id ?? null;

    const hasDirectActiveEdge = Boolean(
      prevActiveId &&
        prevActiveId !== activeId &&
        edges.some((e) => e.source === prevActiveId && e.target === activeId)
    );

    // Mark active edges
    const edgesWithActive = edges.map((e) => {
      const isTransition = hasDirectActiveEdge
        ? e.source === prevActiveId && e.target === activeId
        : e.target === activeId && !(e.data as { isUntaken?: boolean } | undefined)?.isUntaken;
      return {
        ...e,
        data: {
          ...e.data,
          isActive: isTransition,
        },
      };
    });

    return { nodes: nodesWithActive, edges: edgesWithActive };
  }, [visibleNodes, visibleEdges, activeId, currentStep, trace]);

  if (cfgNodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-viz-ink/60 text-sm">
        Run a program to see the control flow graph.
      </div>
    );
  }

  return (
    <ReactFlow
      ref={containerRef}
      nodes={flowNodes as Node[]}
      edges={flowEdges as Edge[]}
      nodeTypes={NODE_TYPES}
      edgeTypes={EDGE_TYPES}
      minZoom={0.2}
      maxZoom={2.5}
      proOptions={{ hideAttribution: true }}
      nodesFocusable={true}
      edgesFocusable={true}
      onMoveStart={handleMoveStart}
    >
      <FlowViewController
        containerRef={containerRef}
        cfgNodes={cfgNodes}
        currentStep={currentStep}
        activeId={activeId}
        flowNodes={flowNodes}
        autoFollow={autoFollow}
        onToggleAutoFollow={() => setAutoFollow((v) => !v)}
        userMovedRef={userMovedRef}
        expandedCount={expandedNodeIds.size}
      />
      <Background color="var(--viz-panel-bg)" gap={16} />
      {/* MiniMap legibility: node fills use the body-bg/body-text contrast
          pair (guaranteed contrast in every palette) with accent for the
          active node; the viewport mask is a color-mix veil derived from the
          theme bg so it never renders as a hardcoded black box. */}
      <MiniMap
        nodeColor={(node) =>
          node.data?.isActive
            ? "var(--viz-accent)"
            : "var(--viz-body-text)"
        }
        maskColor="color-mix(in srgb, var(--viz-body-bg) 62%, transparent)"
        style={{
          background: "var(--viz-panel-bg)",
          border: "1px solid var(--viz-panel-border)",
          borderRadius: 8,
        }}
        pannable
        zoomable
      />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
