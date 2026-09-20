/**
 * components/FlowChart/nodes/CallNode.tsx — Function Call Node.
 *
 * Rendered when a statement invokes another function in the program.
 * Styled in indigo/violet with prominent function badge and clean monospace code.
 */

import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { FlowNodeData } from "./LineNode";

export function CallNode({ data }: NodeProps) {
  const d = data as unknown as FlowNodeData;
  const lineLabel =
    !d.lines || d.lines.length === 0
      ? ""
      : d.lines.length === 1
      ? `L${d.lines[0]}`
      : `L${d.lines[0]}-${d.lines[d.lines.length - 1]}`;

  const targetFunc = d.call_target || "";
  const codeLines = (d.label || "").split("\n").filter(Boolean);

  return (
    <div
      title={d.label}
      className={`relative px-3 py-2 rounded-lg border text-left shadow-sm transition-all select-none overflow-hidden ${
        d.isActive
          ? "border-amber-400 bg-amber-950/30 text-amber-200 shadow-[0_0_12px_rgba(245,158,11,0.35)] ring-1 ring-amber-400"
          : d.isUntaken
          ? "border-indigo-950/40 bg-card/40 text-muted-foreground/60 opacity-60"
          : "border-indigo-500/50 bg-indigo-950/20 text-indigo-100 hover:border-indigo-400"
      }`}
      style={{ width: "260px", height: "68px" }}
    >
      {/* Top entry handle */}
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-indigo-400 !w-2.5 !h-2.5 hover:scale-125 transition-transform"
      />

      {/* Header bar: CALL badge and line number */}
      <div className="flex items-center justify-between text-[10px] font-bold tracking-wider mb-1">
        <div className="flex items-center gap-1.5">
          <span className="bg-indigo-500/25 text-indigo-300 px-1.5 py-0.5 rounded uppercase tracking-wider font-semibold">
            Call {targetFunc ? `${targetFunc}()` : ""}
          </span>
        </div>
        {lineLabel && (
          <span className="font-mono text-[9px] bg-muted/60 px-1 py-0.5 rounded text-foreground/70">
            {lineLabel}
          </span>
        )}
      </div>

      {/* Statement code preview */}
      <div className="font-mono text-[11px] leading-tight space-y-0.5 overflow-hidden">
        {codeLines.slice(0, 2).map((line, idx) => (
          <div key={idx} className="truncate text-indigo-200/90 font-medium">
            {line}
          </div>
        ))}
        {codeLines.length > 2 && (
          <div className="text-[9px] text-indigo-400/70 italic truncate">
            +{codeLines.length - 2} more...
          </div>
        )}
      </div>

      {/* Bottom exit handle */}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-indigo-400 !w-2.5 !h-2.5 hover:scale-125 transition-transform"
      />
    </div>
  );
}
