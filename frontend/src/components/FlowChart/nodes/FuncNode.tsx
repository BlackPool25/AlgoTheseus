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
        backgroundColor: "var(--flow-func-bg)",
        borderColor: "var(--flow-func-border)",
        color: "var(--flow-func-code)",
      };

  return (
    <div
      title={d.label}
      className={`relative px-3 py-2 rounded-lg border text-left shadow-xs transition-all select-none overflow-hidden ${
        d.isActive ? "ring-1 ring-[var(--flow-active-ring)]" : ""
      } ${d.isUntaken && !d.isActive ? "opacity-60 border-dashed" : ""}`}
      style={{ width: "260px", height: "68px", ...containerStyle }}
    >
      {/* Header bar: Entry badge and line number */}
      <div className="flex items-center justify-between text-[10px] uppercase font-bold tracking-wider mb-1">
        <span
          style={{
            backgroundColor: "var(--flow-func-badge-bg)",
            color: d.isActive
              ? "var(--flow-active-text)"
              : d.isUntaken
              ? "var(--flow-untaken-text)"
              : "var(--flow-func-title)",
          }}
          className="px-1.5 py-0.5 rounded font-semibold"
        >
          Function
        </span>
        {lineLabel && (
          <span
            style={{
              backgroundColor: "var(--flow-func-badge-bg)",
              color: d.isActive
                ? "var(--flow-active-text)"
                : d.isUntaken
                ? "var(--flow-untaken-text)"
                : "var(--flow-func-title)",
            }}
            className="font-mono text-[9px] px-1 py-0.5 rounded"
          >
            {lineLabel}
          </span>
        )}
      </div>

      {/* Function name */}
      <div
        style={{
          color: d.isActive
            ? "var(--flow-active-text)"
            : d.isUntaken
            ? "var(--flow-untaken-text)"
            : "var(--flow-func-code)",
        }}
        className="text-xs font-mono font-bold truncate mt-1"
      >
        {d.label}
      </div>

      {/* Exit handle at bottom */}
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ backgroundColor: "var(--flow-func-handle)" }}
        className="!w-2.5 !h-2.5 hover:scale-125 transition-transform"
      />
    </div>
  );
}

export function FuncEndNode({ data }: NodeProps) {
  const d = data as unknown as FlowNodeData;
  const lineLabel =
    d.lines && d.lines.length > 0 ? `L${d.lines[0]}` : "";

  const containerStyle = d.isActive
    ? {
        backgroundColor: "var(--flow-active-bg)",
        borderColor: "var(--flow-active-border)",
        color: "var(--flow-active-text)",
        boxShadow: "0 0 12px var(--flow-active-shadow)",
      }
    : {
        backgroundColor: "var(--flow-func-end-bg)",
        borderColor: "var(--flow-func-end-border)",
        color: "var(--flow-func-end-code)",
      };

  return (
    <div
      title={d.label}
      className={`relative px-3 py-2 rounded-lg border text-left shadow-xs transition-all select-none overflow-hidden ${
        d.isActive ? "ring-1 ring-[var(--flow-active-ring)]" : ""
      }`}
      style={{ width: "260px", height: "68px", ...containerStyle }}
    >
      {/* Entry handle at top */}
      <Handle
        type="target"
        position={Position.Top}
        style={{ backgroundColor: "var(--flow-func-end-handle)" }}
        className="!w-2.5 !h-2.5 hover:scale-125 transition-transform"
      />

      {/* Header bar: Exit badge and line number */}
      <div className="flex items-center justify-between text-[10px] uppercase font-bold tracking-wider mb-1">
        <span
          style={{
            backgroundColor: "var(--flow-func-end-badge-bg)",
            color: d.isActive ? "var(--flow-active-text)" : "var(--flow-func-end-title)",
          }}
          className="px-1.5 py-0.5 rounded font-semibold"
        >
          Exit
        </span>
        {lineLabel && (
          <span
            style={{
              backgroundColor: "var(--flow-func-end-badge-bg)",
              color: d.isActive ? "var(--flow-active-text)" : "var(--flow-func-end-title)",
            }}
            className="font-mono text-[9px] px-1 py-0.5 rounded"
          >
            {lineLabel}
          </span>
        )}
      </div>

      {/* Exit label */}
      <div
        style={{
          color: d.isActive ? "var(--flow-active-text)" : "var(--flow-func-end-code)",
        }}
        className="text-xs font-mono truncate mt-1"
      >
        {d.label}
      </div>
    </div>
  );
}
