/**
 * store/cfgStore.ts — Zustand store for the CFG flowchart.
 *
 * Owns: CFG nodes/edges, expanded node set, and the active node ID.
 * The active node is derived from traceStore.currentStep — it's set
 * externally by the App component when the step changes.
 */

import { create } from "zustand";
import type { CFGEdge, CFGNode } from "../types/cfg";

interface CFGStore {
  nodes: CFGNode[];
  edges: CFGEdge[];
  expandedNodeIds: Set<string>;
  activeNodeId: string | null;

  loadCFG: (nodes: CFGNode[], edges: CFGEdge[]) => void;
  setActiveNode: (id: string | null) => void;
  toggleExpand: (id: string) => void;
  reset: () => void;
}

export const useCFGStore = create<CFGStore>((set, get) => ({
  nodes: [],
  edges: [],
  expandedNodeIds: new Set(),
  activeNodeId: null,

  loadCFG: (nodes, edges) =>
    set({ nodes, edges, expandedNodeIds: new Set(), activeNodeId: null }),

  setActiveNode: (id) => set({ activeNodeId: id }),

  toggleExpand: (id) => {
    const { expandedNodeIds } = get();
    const next = new Set(expandedNodeIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    set({ expandedNodeIds: next });
  },

  reset: () =>
    set({ nodes: [], edges: [], expandedNodeIds: new Set(), activeNodeId: null }),
}));
