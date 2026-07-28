/**
 * components/FlowChart/nodes/LoopNode.tsx — Collapsed loop node with iteration count.
 *
 * Click to expand/collapse (dispatches to cfgStore).
 * Starts collapsed — never auto-expands.
 */

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useCFGStore } from "../../../store/cfgStore";

interface LoopNodeData {
  label: string;
  isActive: boolean;
}

export function LoopNode({ id, data }: NodeProps) {
  const d = data as unknown as LoopNodeData;
  const isExpanded = useCFGStore((s) => s.expandedNodeIds.has(id));
  const toggleExpand = useCFGStore((s) => s.toggleExpand);

  return (
    <div
      onClick={() => toggleExpand(id)}
      className={`px-3 py-2 rounded border text-xs font-mono min-w-[140px] text-center cursor-pointer transition-colors ${
        d.isActive
          ? "border-amber-400 bg-amber-400/10 text-amber-300"
          : "border-emerald-700 bg-emerald-900/30 text-emerald-300"
      }`}
    >
      <Handle type="target" position={Position.Top} className="!bg-emerald-600" />
      <div className="flex items-center justify-center gap-1">
        <span>{isExpanded ? "▾" : "▸"}</span>
        <span className="truncate">{d.label}</span>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-emerald-600" />
    </div>
  );
}
