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

  const containerStyle = d.isActive
    ? {
        backgroundColor: "var(--flow-active-bg)",
        borderColor: "var(--flow-active-border)",
        color: "var(--flow-active-text)",
        boxShadow: "0 0 12px var(--flow-active-shadow)",
      }
    : d.isUntaken
    ? {
        backgroundColor: "var(--flow-untaken-bg)",
        borderColor: "var(--flow-untaken-border)",
        color: "var(--flow-untaken-text)",
      }
    : {
        backgroundColor: "var(--flow-call-bg)",
        borderColor: "var(--flow-call-border)",
        color: "var(--flow-call-code)",
      };

  return (
    <div
      title={d.label}
      className={`relative px-3 py-2 rounded-lg border text-left shadow-xs transition-all select-none overflow-hidden ${
        d.isActive ? "ring-1 ring-[var(--flow-active-ring)]" : ""
      } ${d.isUntaken && !d.isActive ? "opacity-60 border-dashed" : ""}`}
      style={{ width: "260px", height: "68px", ...containerStyle }}
    >
      {/* Top entry handle */}
      <Handle
        type="target"
        position={Position.Top}
        style={{ backgroundColor: "var(--flow-call-handle)" }}
        className="!w-2.5 !h-2.5 hover:scale-125 transition-transform"
      />

      {/* Header bar: CALL badge and line number */}
      <div className="flex items-center justify-between text-[10px] font-bold tracking-wider mb-1">
        <div className="flex items-center gap-1.5">
          <span
            style={{
              backgroundColor: "var(--flow-call-badge-bg)",
              color: d.isActive
                ? "var(--flow-active-text)"
                : d.isUntaken
                ? "var(--flow-untaken-text)"
                : "var(--flow-call-title)",
            }}
            className="px-1.5 py-0.5 rounded uppercase tracking-wider font-semibold"
          >
            Call {targetFunc ? `${targetFunc}()` : ""}
          </span>
        </div>
        {lineLabel && (
          <span
            style={{
              backgroundColor: "var(--flow-call-badge-bg)",
              color: d.isActive
                ? "var(--flow-active-text)"
                : d.isUntaken
                ? "var(--flow-untaken-text)"
                : "var(--flow-call-title)",
            }}
            className="font-mono text-[9px] px-1 py-0.5 rounded"
          >
            {lineLabel}
          </span>
        )}
      </div>

      {/* Statement code preview */}
      <div className="font-mono text-[11px] leading-tight space-y-0.5 overflow-hidden">
        {codeLines.slice(0, 2).map((line, idx) => (
          <div
            key={idx}
            style={{
              color: d.isActive
                ? "var(--flow-active-text)"
                : d.isUntaken
                ? "var(--flow-untaken-text)"
                : "var(--flow-call-code)",
            }}
            className="truncate font-medium"
          >
            {line}
          </div>
        ))}
        {codeLines.length > 2 && (
          <div
            style={{
              color: d.isActive
                ? "var(--flow-active-text)"
                : d.isUntaken
                ? "var(--flow-untaken-text)"
                : "var(--flow-call-title)",
            }}
            className="text-[9px] italic truncate opacity-75"
          >
            +{codeLines.length - 2} more...
          </div>
        )}
      </div>

      {/* Bottom exit handle */}
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ backgroundColor: "var(--flow-call-handle)" }}
        className="!w-2.5 !h-2.5 hover:scale-125 transition-transform"
      />
    </div>
  );
}
