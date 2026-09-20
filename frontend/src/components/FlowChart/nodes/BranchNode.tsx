/**
 * components/FlowChart/nodes/BranchNode.tsx — If/else diamond node.
 */

import { Handle, Position, type NodeProps } from "@xyflow/react";

interface BranchNodeData {
  label: string;
  isActive: boolean;
  isUntaken?: boolean;
}

export function BranchNode({ data }: NodeProps) {
  const d = data as unknown as BranchNodeData;
  return (
    <div
      title={d.label}
      style={{ width: 240, height: 60 }}
      className={`relative px-2.5 py-1.5 rounded-lg border text-left flex flex-col justify-center transition-all shadow-xs select-none ${
        d.isActive
          ? "border-amber-400 bg-amber-950/40 text-amber-200 shadow-[0_0_14px_rgba(251,191,36,0.35)]"
          : d.isUntaken
          ? "border-dashed border-zinc-700/50 bg-zinc-900/30 text-zinc-500/70 opacity-45"
          : "border-blue-700/70 bg-blue-950/30 text-blue-200 hover:border-blue-600"
      }`}
    >
      <Handle type="target" position={Position.Top} className="!bg-blue-500 !w-2 !h-2" />

      {/* Header Row */}
      <div className="flex items-center justify-between gap-1 text-[10px] font-mono leading-none mb-1 opacity-75">
        <span className="font-semibold uppercase tracking-wider text-[9px] text-blue-400">Branch</span>
        <div className="flex items-center gap-1.5 text-[8px]">
          <span className="text-emerald-400 font-bold">T: Left</span>
          <span className="text-rose-400 font-bold">F: Right</span>
        </div>
      </div>

      {/* Condition Text */}
      <div className="text-xs font-mono font-medium truncate leading-tight">
        {d.label}
      </div>

      {/* True handle (left 30%) and False handle (right 70%) */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="true"
        style={{ left: "30%" }}
        className="!bg-emerald-500 !w-2.5 !h-2.5 hover:scale-125 transition-transform"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="false"
        style={{ left: "70%" }}
        className="!bg-rose-500 !w-2.5 !h-2.5 hover:scale-125 transition-transform"
      />
    </div>
  );
}
