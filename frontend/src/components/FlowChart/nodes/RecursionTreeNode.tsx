/**
 * components/FlowChart/nodes/RecursionTreeNode.tsx — Recursive call node.
 *
 * Shown when a function calls itself (detected by cfg_builder).
 * Displays the recursion depth and function name with a distinct purple style.
 */

import { Handle, Position, type NodeProps } from "@xyflow/react";

interface RecursionNodeData {
  label: string;
  isActive: boolean;
}

export function RecursionTreeNode({ data }: NodeProps) {
  const d = data as unknown as RecursionNodeData;

  return (
    <div
      className={`px-3 py-2 rounded border text-xs font-mono min-w-[140px] text-center transition-colors ${
        d.isActive
          ? "border-purple-400 bg-purple-400/10 text-purple-200 shadow-[0_0_8px_rgba(168,85,247,0.3)]"
          : "border-purple-800 bg-purple-900/20 text-purple-400"
      }`}
    >
      <Handle type="target" position={Position.Top} className="!bg-purple-600" />
      <div className="flex items-center justify-center gap-1">
        <span className="text-purple-500">↻</span>
        <span className="truncate">{d.label}</span>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-purple-600" />
    </div>
  );
}
