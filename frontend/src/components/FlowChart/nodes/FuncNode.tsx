/**
 * components/FlowChart/nodes/FuncNode.tsx — Function Start and End Nodes.
 *
 * FuncStartNode: Entry point of a function, styled in sky/cyan with bottom handle only.
 * FuncEndNode: Exit point of a function, styled in zinc/slate with top handle only.
 */

import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { FlowNodeData } from "./LineNode";

export function FuncStartNode({ data }: NodeProps) {
  const d = data as unknown as FlowNodeData;
  const lineLabel =
    d.lines && d.lines.length > 0 ? `L${d.lines[0]}` : "";

  return (
    <div
      title={d.label}
      className={`relative px-3 py-2 rounded-lg border text-left shadow-sm transition-all select-none overflow-hidden ${
        d.isActive
          ? "border-amber-400 bg-amber-950/30 text-amber-200 shadow-[0_0_12px_rgba(245,158,11,0.35)] ring-1 ring-amber-400"
          : d.isUntaken
          ? "border-sky-950/40 bg-card/40 text-muted-foreground/60 opacity-60"
          : "border-sky-500/60 bg-sky-950/25 text-sky-100 hover:border-sky-400"
      }`}
      style={{ width: "260px", height: "68px" }}
    >
      {/* Header bar: Entry badge and line number */}
      <div className="flex items-center justify-between text-[10px] uppercase font-bold tracking-wider mb-1">
        <span className="bg-sky-500/25 text-sky-300 px-1.5 py-0.5 rounded font-semibold">
          Function
        </span>
        {lineLabel && (
          <span className="font-mono text-[9px] bg-muted/60 px-1 py-0.5 rounded text-foreground/70">
            {lineLabel}
          </span>
        )}
      </div>

      {/* Function name */}
      <div className="text-xs font-mono font-bold text-sky-200 truncate mt-1">
        {d.label}
      </div>

      {/* Exit handle at bottom */}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-sky-400 !w-2.5 !h-2.5 hover:scale-125 transition-transform"
      />
    </div>
  );
}

export function FuncEndNode({ data }: NodeProps) {
  const d = data as unknown as FlowNodeData;
  const lineLabel =
    d.lines && d.lines.length > 0 ? `L${d.lines[0]}` : "";

  return (
    <div
      title={d.label}
      className={`relative px-3 py-2 rounded-lg border text-left shadow-sm transition-all select-none overflow-hidden ${
        d.isActive
          ? "border-amber-400 bg-amber-950/30 text-amber-200 shadow-[0_0_12px_rgba(245,158,11,0.35)] ring-1 ring-amber-400"
          : "border-zinc-700/60 bg-zinc-900/40 text-zinc-300"
      }`}
      style={{ width: "260px", height: "68px" }}
    >
      {/* Entry handle at top */}
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-zinc-500 !w-2.5 !h-2.5 hover:scale-125 transition-transform"
      />

      {/* Header bar: Exit badge and line number */}
      <div className="flex items-center justify-between text-[10px] uppercase font-bold tracking-wider mb-1">
        <span className="bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded font-semibold">
          Exit
        </span>
        {lineLabel && (
          <span className="font-mono text-[9px] bg-muted/60 px-1 py-0.5 rounded text-foreground/70">
            {lineLabel}
          </span>
        )}
      </div>

      {/* Exit label */}
      <div className="text-xs font-mono text-zinc-400 truncate mt-1">
        {d.label}
      </div>
    </div>
  );
}
