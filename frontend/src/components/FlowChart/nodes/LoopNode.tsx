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
  isUntaken?: boolean;
  children?: string[];
}

export function LoopNode({ id, data }: NodeProps) {
  const d = data as unknown as LoopNodeData;
  const hasChildren = (d.children?.length ?? 0) > 0;
  const isExpanded = useCFGStore((s) => s.expandedNodeIds.has(id));
  const toggleExpand = useCFGStore((s) => s.toggleExpand);

  return (
    <div
      title={d.label}
      onClick={hasChildren ? () => toggleExpand(id) : undefined}
      style={{ width: 220, height: 60 }}
      className={`relative px-2.5 py-1.5 rounded-lg border text-left flex flex-col justify-center transition-all shadow-xs select-none ${
        hasChildren ? "cursor-pointer" : ""
      } ${
        d.isActive
          ? "border-amber-400 bg-amber-950/40 text-amber-200 shadow-[0_0_14px_rgba(251,191,36,0.35)]"
          : d.isUntaken
          ? "border-dashed border-zinc-700/50 bg-zinc-900/30 text-zinc-500/70 opacity-45"
          : "border-emerald-700/70 bg-emerald-950/30 text-emerald-200 hover:border-emerald-600"
      }`}
    >
      {/* Top entry handle */}
      <Handle type="target" position={Position.Top} className="!bg-emerald-500 !w-2 !h-2" />

      {/* Dedicated Left side handle for incoming loop back-edges */}
      <Handle
        type="target"
        position={Position.Left}
        id="loop-back"
        style={{ top: "50%" }}
        className="!bg-emerald-400 !w-2.5 !h-2.5 hover:scale-125 transition-transform"
      />

      {/* Header Row */}
      <div className="flex items-center justify-between gap-1 text-[10px] font-mono leading-none mb-1 opacity-75">
        <span className="font-semibold uppercase tracking-wider text-[9px] text-emerald-400 flex items-center gap-1">
          {hasChildren && <span>{isExpanded ? "▾" : "▸"}</span>}
          Loop
        </span>
        <div className="flex items-center gap-1.5 text-[8px]">
          <span className="text-emerald-400 font-bold">Body</span>
          <span className="text-rose-400 font-bold">Exit</span>
        </div>
      </div>

      {/* Loop condition text */}
      <div className="text-xs font-mono font-medium truncate leading-tight">
        {d.label}
      </div>

      {/* True / Loop body handle (left 30%) and False / Exit handle (right 70%) */}
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
