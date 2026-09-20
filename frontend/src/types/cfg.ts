/**
 * types/cfg.ts — CFG node and edge type definitions.
 */

export type CFGNodeType =
  | "line"
  | "branch"
  | "loop"
  | "func_call"
  | "func_start"
  | "func_end";

export interface CFGNode {
  id: string;
  type: CFGNodeType;
  lines: number[];
  label: string;
  children: string[];
  trace_indices: number[];
  is_untaken?: boolean;
  func?: string;
  call_target?: string | null;
}

export interface CFGEdge {
  source: string;
  target: string;
  label: string;
  source_handle?: string | null;
  target_handle?: string | null;
  is_untaken?: boolean;
}
