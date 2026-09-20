/**
 * components/FlowChart/nodes/BranchNode.tsx — If/else diamond node.
 */

import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { FlowNodeData } from "./LineNode";

export function BranchNode({ data }: NodeProps) {
  const d = data as unknown as FlowNodeData;
  const lineBadge =
    d.lines && d.lines.length > 0 ? `L${d.lines[0]}` : "";

  const containerStyle = d.isActive
    ? {
        backgroundColor: "var(--flow-active-bg)",
        borderColor: "var(--flow-active-border)",
        color: "var(--flow-active-text)",
        boxShadow: "0 0 14px var(--flow-active-shadow)",
      }
    : d.isUntaken
    ? {
        backgroundColor: "var(--flow-untaken-bg)",
        borderColor: "var(--flow-untaken-border)",
        color: "var(--flow-untaken-text)",
      }
    : {
        backgroundColor: "var(--flow-branch-bg)",
        borderColor: "var(--flow-branch-border)",
        color: "var(--flow-branch-code)",
      };

  return (
    <div
      title={d.label}
      style={{ width: 270, height: 68, ...containerStyle }}
      className={`relative px-3 py-2 rounded-lg border text-left flex flex-col justify-center transition-all shadow-xs select-none ${
        d.isUntaken && !d.isActive ? "border-dashed opacity-45" : ""
      }`}
    >
      <Handle
        type="target"
        position={Position.Top}
        style={{ backgroundColor: "var(--flow-branch-border)" }}
        className="!w-2.5 !h-2.5"
      />

      {/* Header Row */}
      <div className="flex items-center justify-between gap-1 text-[10px] font-mono leading-none mb-1 opacity-90">
        <div className="flex items-center gap-1.5">
          <span
            style={{
              color: d.isActive
                ? "var(--flow-active-border)"
                : d.isUntaken
                ? "var(--flow-untaken-text)"
                : "var(--flow-branch-title)",
            }}
            className="font-semibold uppercase tracking-wider text-[9px]"
          >
            Branch
          </span>
          {lineBadge && (
            <span
              style={{
                backgroundColor: "var(--flow-branch-badge-bg)",
                color: d.isActive
                  ? "var(--flow-active-text)"
                  : d.isUntaken
                  ? "var(--flow-untaken-text)"
                  : "var(--flow-branch-title)",
              }}
              className="px-1 py-0.5 rounded text-[9px]"
            >
              {lineBadge}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-[8px]">
          <span style={{ color: "var(--flow-true-handle)" }} className="font-bold">T: Left</span>
          <span style={{ color: "var(--flow-false-handle)" }} className="font-bold">F: Right</span>
        </div>
      </div>

      {/* Condition Text */}
      <div
        style={{
          color: d.isActive
            ? "var(--flow-active-text)"
            : d.isUntaken
            ? "var(--flow-untaken-text)"
            : "var(--flow-branch-code)",
        }}
        className="text-xs font-mono font-medium truncate leading-tight"
      >
        {d.label}
      </div>

      {/* True handle (left 30%) and False handle (right 70%) */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="true"
        style={{ left: "30%", backgroundColor: "var(--flow-true-handle)" }}
        className="!w-2.5 !h-2.5 hover:scale-125 transition-transform"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="false"
        style={{ left: "70%", backgroundColor: "var(--flow-false-handle)" }}
        className="!w-2.5 !h-2.5 hover:scale-125 transition-transform"
      />
    </div>
  );
}
