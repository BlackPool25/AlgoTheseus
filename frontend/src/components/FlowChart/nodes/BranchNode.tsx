/**
 * components/FlowChart/nodes/BranchNode.tsx — If/else diamond node.
 */

import { Handle, Position, type NodeProps } from "@xyflow/react";

interface BranchNodeData {
  label: string;
  isActive: boolean;
}

export function BranchNode({ data }: NodeProps) {
  const d = data as unknown as BranchNodeData;
  return (
    <div
      className={`px-3 py-2 rounded-full border text-xs font-mono min-w-[140px] text-center transition-colors ${
        d.isActive
          ? "border-amber-400 bg-amber-400/10 text-amber-300"
          : "border-blue-700 bg-blue-900/30 text-blue-300"
      }`}
    >
      <Handle type="target" position={Position.Top} className="!bg-blue-600" />
      <div className="truncate">{d.label}</div>
      <Handle type="source" position={Position.Bottom} id="true"  className="!bg-emerald-600 !left-[30%]" />
      <Handle type="source" position={Position.Bottom} id="false" className="!bg-red-600 !left-[70%]" />
    </div>
  );
}
