/**
 * components/FlowChart/nodes/LoopNode.tsx — Collapsed loop node with iteration count.
 *
 * Click to expand/collapse (dispatches to cfgStore).
 * Starts collapsed — never auto-expands.
 */

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useCFGStore } from "../../../store/cfgStore";

import type { FlowNodeData } from "./LineNode";

export function LoopNode({ id, data }: NodeProps) {
  const d = data as unknown as FlowNodeData;
  const hasChildren = (d.children?.length ?? 0) > 0;
  const isExpanded = useCFGStore((s) => s.expandedNodeIds.has(id));
  const toggleExpand = useCFGStore((s) => s.toggleExpand);
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
        backgroundColor: "var(--flow-loop-bg)",
        borderColor: "var(--flow-loop-border)",
        color: "var(--flow-loop-code)",
      };

  return (
    <div
      title={d.label}
      onClick={hasChildren ? () => toggleExpand(id) : undefined}
      style={{ width: 260, height: 68, ...containerStyle }}
      className={`relative px-3 py-2 rounded-lg border text-left flex flex-col justify-center transition-all shadow-xs select-none ${
        hasChildren ? "cursor-pointer" : ""
      } ${d.isUntaken && !d.isActive ? "border-dashed opacity-45" : ""}`}
    >
      {/* Top entry handle */}
      <Handle
        type="target"
        position={Position.Top}
        style={{ backgroundColor: "var(--flow-loop-border)" }}
        className="!w-2.5 !h-2.5"
      />

      {/* Dedicated Left side handle for incoming loop back-edges */}
      <Handle
        type="target"
        position={Position.Left}
        id="loop-back"
        style={{ top: "50%", backgroundColor: "var(--flow-loop-border)" }}
        className="!w-2.5 !h-2.5 hover:scale-125 transition-transform"
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
                : "var(--flow-loop-title)",
            }}
            className="font-semibold uppercase tracking-wider text-[9px] flex items-center gap-1"
          >
            {hasChildren && <span>{isExpanded ? "▾" : "▸"}</span>}
            Loop
          </span>
          {lineBadge && (
            <span
              style={{
                backgroundColor: "var(--flow-loop-badge-bg)",
                color: d.isActive
                  ? "var(--flow-active-text)"
                  : d.isUntaken
                  ? "var(--flow-untaken-text)"
                  : "var(--flow-loop-title)",
              }}
              className="px-1 py-0.5 rounded text-[9px]"
            >
              {lineBadge}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-[8px]">
          <span style={{ color: "var(--flow-true-handle)" }} className="font-bold">Body</span>
          <span style={{ color: "var(--flow-false-handle)" }} className="font-bold">Exit</span>
        </div>
      </div>

      {/* Loop condition text */}
      <div
        style={{
          color: d.isActive
            ? "var(--flow-active-text)"
            : d.isUntaken
            ? "var(--flow-untaken-text)"
            : "var(--flow-loop-code)",
        }}
        className="text-xs font-mono font-medium truncate leading-tight"
      >
        {d.label}
      </div>

      {/* True / Loop body handle (left 30%) and False / Exit handle (right 70%) */}
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
