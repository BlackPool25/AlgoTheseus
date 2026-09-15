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
import { useEffect, useMemo, useRef } from "react";
import { useCFGStore } from "../../store/cfgStore";
import { useTraceStore } from "../../store/traceStore";
import type { CFGNode } from "../../types/cfg";
import { layoutCFG } from "../../utils/cfgLayout";
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
 * Inner component rendered inside <ReactFlow> so useReactFlow() is available.
 * Handles initial fitView on CFG load and smooth pan-to-active on step change.
 */
function FlowViewController({
  containerRef,
  cfgNodes,
  currentStep,
  activeId,
  flowNodes,
}: {
  containerRef: { readonly current: HTMLDivElement | null };
  cfgNodes: CFGNode[];
  currentStep: number;
  activeId: string | null;
  flowNodes: Node[];
}) {
  const { fitView, setCenter, getViewport } = useReactFlow();
  const initialFitDone = useRef(false);

  // FitView once when cfgNodes first loads (empty → non-empty)
  useEffect(() => {
    if (cfgNodes.length > 0 && !initialFitDone.current) {
      fitView({ padding: 0.2, duration: 200 });
      initialFitDone.current = true;
    }
  }, [cfgNodes.length, fitView]);

  // On step change: smooth-pan to active node ONLY if it's off-screen
  useEffect(() => {
    if (!activeId || flowNodes.length === 0) return;

    const node = flowNodes.find((n) => n.id === activeId);
    if (!node) return;

    const viewport = getViewport();
    const el = containerRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const MARGIN = 150;

    // Convert flow coordinate to screen coordinate
    const sx = node.position.x * viewport.zoom + viewport.x;
    const sy = node.position.y * viewport.zoom + viewport.y;

    const isOffScreen =
      sx < -MARGIN ||
      sx > rect.width + MARGIN ||
      sy < -MARGIN ||
      sy > rect.height + MARGIN;

    if (isOffScreen) {
      const cx = node.position.x + (node.measured?.width ?? 100) / 2;
      const cy = node.position.y + (node.measured?.height ?? 50) / 2;
      setCenter(cx, cy, { zoom: viewport.zoom, duration: 400 });
    }
  }, [currentStep]);

  return null;
}

export function TraceFlow() {
  const cfgNodes = useCFGStore((s) => s.nodes);
  const cfgEdges = useCFGStore((s) => s.edges);
  const activeNodeId = useCFGStore((s) => s.activeNodeId);
  const expandedNodeIds = useCFGStore((s) => s.expandedNodeIds);
  const currentStep = useTraceStore((s) => s.currentStep);
  const containerRef = useRef<HTMLDivElement>(null);

  // Derive active node from current step
  const activeId = useMemo(() => {
    const node = cfgNodes.find((n) => n.trace_indices.includes(currentStep));
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
      data: { ...n.data, isActive: n.id === activeId },
    }));

    // Mark active edges (edges leading to the active node)
    const edgesWithActive = edges.map((e) => ({
      ...e,
      data: { isActive: e.target === activeId },
    }));

    return { nodes: nodesWithActive, edges: edgesWithActive };
  }, [visibleNodes, visibleEdges, activeId]);

  if (cfgNodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-600 text-sm">
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
    >
      <FlowViewController
        containerRef={containerRef}
        cfgNodes={cfgNodes}
        currentStep={currentStep}
        activeId={activeId}
        flowNodes={flowNodes}
      />
      <Background color="#27272a" gap={16} />
      <MiniMap
        nodeColor={(node) => (node.data?.isActive ? '#f59e0b' : '#52525b')}
        maskColor="rgba(0,0,0,0.7)"
        style={{ background: '#18181b' }}
        pannable
        zoomable
      />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
