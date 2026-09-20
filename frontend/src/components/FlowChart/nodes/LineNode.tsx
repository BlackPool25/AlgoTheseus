/**
 * components/FlowChart/nodes/LineNode.tsx — Single statement / function node.
 */

import { Handle, Position, type NodeProps } from "@xyflow/react";

export interface FlowNodeData {
  label: string;
  lines: number[];
  isActive: boolean;
  isUntaken?: boolean;
  func?: string;
  call_target?: string | null;
  children?: string[];
}

export function LineNode({ data }: NodeProps) {
  const d = data as unknown as FlowNodeData;
  const isSingle = (d.lines?.length ?? 0) === 1;
  const lineBadge = isSingle
    ? `L${d.lines[0]}`
    : (d.lines?.length ?? 0) > 1
    ? `L${d.lines[0]}–${d.lines[d.lines.length - 1]}`
    : "";

  const codeLines = (d.label || "").split("\n").filter(Boolean);

  return (
    <div
      title={d.label}
      style={{ width: 260, height: 68 }}
      className={`relative px-3 py-2 rounded-lg border text-left flex flex-col justify-center transition-all shadow-xs select-none ${
        d.isActive
          ? "border-amber-400 bg-amber-950/40 text-amber-200 shadow-[0_0_14px_rgba(251,191,36,0.35)]"
          : d.isUntaken
          ? "border-dashed border-zinc-700/50 bg-zinc-900/30 text-zinc-500/70 opacity-45"
          : "border-viz-line bg-viz-panel/90 text-viz-ink hover:border-viz-line/80"
      }`}
    >
      <Handle type="target" position={Position.Top} className="!bg-viz-line !w-2.5 !h-2.5" />

      {/* Top Header Row */}
      <div className="flex items-center justify-between gap-1 text-[10px] font-mono leading-none mb-1 opacity-70">
        <span className="font-semibold uppercase tracking-wider text-[9px] text-viz-ink/60">
          Statement
        </span>
        {lineBadge && (
          <span className="bg-viz-body/80 px-1 py-0.5 rounded border border-viz-line text-[9px]">
            {lineBadge}
          </span>
        )}
      </div>

      {/* Main Statement Label / Code Lines */}
      <div className="font-mono text-[11px] leading-tight space-y-0.5 overflow-hidden">
        {codeLines.slice(0, 2).map((line, idx) => (
          <div key={idx} className="truncate text-viz-ink font-medium">
            {line}
          </div>
        ))}
        {codeLines.length > 2 && (
          <div className="text-[9px] text-muted-foreground italic truncate">
            +{codeLines.length - 2} more...
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-viz-line !w-2.5 !h-2.5" />
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
