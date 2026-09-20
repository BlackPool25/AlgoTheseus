/**
 * components/FlowChart/nodes/LineNode.tsx — Single statement / function node.
 */

import { Handle, Position, type NodeProps } from "@xyflow/react";

interface LineNodeData {
  label: string;
  lines: number[];
  isActive: boolean;
  isUntaken?: boolean;
}

export function LineNode({ data }: NodeProps) {
  const d = data as unknown as LineNodeData;
  const isSingle = (d.lines?.length ?? 0) === 1;
  const lineBadge = isSingle
    ? `L${d.lines[0]}`
    : (d.lines?.length ?? 0) > 1
    ? `L${d.lines[0]}–${d.lines[d.lines.length - 1]}`
    : "";

  return (
    <div
      title={d.label}
      style={{ width: 220, height: 60 }}
      className={`relative px-2.5 py-1.5 rounded-lg border text-left flex flex-col justify-center transition-all shadow-xs select-none ${
        d.isActive
          ? "border-amber-400 bg-amber-950/40 text-amber-200 shadow-[0_0_14px_rgba(251,191,36,0.35)]"
          : d.isUntaken
          ? "border-dashed border-zinc-700/50 bg-zinc-900/30 text-zinc-500/70 opacity-45"
          : "border-viz-line bg-viz-panel/90 text-viz-ink hover:border-viz-line/80"
      }`}
    >
      <Handle type="target" position={Position.Top} className="!bg-viz-line !w-2 !h-2" />

      {/* Top Header Row */}
      <div className="flex items-center justify-between gap-1 text-[10px] font-mono leading-none mb-1 opacity-70">
        <span className="font-semibold uppercase tracking-wider text-[9px] text-viz-ink/60">Block</span>
        {lineBadge && (
          <span className="bg-viz-body/80 px-1 py-0.5 rounded border border-viz-line text-[9px]">
            {lineBadge}
          </span>
        )}
      </div>

      {/* Main Statement Label */}
      <div className="text-xs font-mono font-medium truncate leading-tight text-viz-ink">
        {d.label}
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-viz-line !w-2 !h-2" />
      <Handle
        type="source"
        position={Position.Left}
        id="loop-return"
        style={{ top: "50%" }}
        className="!bg-viz-line !w-1.5 !h-1.5 !opacity-0"
      />
    </div>
  );
}
