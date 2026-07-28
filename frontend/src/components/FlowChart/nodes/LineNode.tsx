/**
 * components/FlowChart/nodes/LineNode.tsx — Single statement / function node.
 */

import { Handle, Position, type NodeProps } from "@xyflow/react";

interface LineNodeData {
  label: string;
  lines: number[];
  isActive: boolean;
}

export function LineNode({ data }: NodeProps) {
  const d = data as unknown as LineNodeData;
  return (
    <div
      className={`px-3 py-2 rounded border text-xs font-mono min-w-[140px] text-center transition-colors ${
        d.isActive
          ? "border-amber-400 bg-amber-400/10 text-amber-300"
          : "border-zinc-700 bg-zinc-800 text-zinc-300"
      }`}
    >
      <Handle type="target" position={Position.Top} className="!bg-zinc-600" />
      <div className="truncate">{d.label}</div>
      <Handle type="source" position={Position.Bottom} className="!bg-zinc-600" />
    </div>
  );
}
