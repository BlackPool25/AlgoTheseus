/**
 * components/FlowChart/nodes/RecursionTreeNode.tsx — Recursive call node.
 *
 * Shown when a function calls itself (detected by cfg_builder).
 * Displays the recursion depth and function name with a distinct purple style.
 */

import { Handle, Position, type NodeProps } from "@xyflow/react";

interface RecursionNodeData {
  label: string;
  isActive: boolean;
}

export function RecursionTreeNode({ data }: NodeProps) {
  const d = data as unknown as RecursionNodeData;

  const containerStyle = d.isActive
    ? {
        backgroundColor: "var(--flow-active-bg)",
        borderColor: "var(--flow-active-border)",
        color: "var(--flow-active-text)",
        boxShadow: "0 0 12px var(--flow-active-shadow)",
      }
    : {
        backgroundColor: "var(--flow-call-bg)",
        borderColor: "var(--flow-call-border)",
        color: "var(--flow-call-code)",
      };

  return (
    <div
      style={containerStyle}
      className={`px-3 py-2 rounded-lg border text-xs font-mono min-w-[140px] text-center transition-colors ${
        d.isActive ? "ring-1 ring-[var(--flow-active-ring)]" : ""
      }`}
    >
      <Handle
        type="target"
        position={Position.Top}
        style={{ backgroundColor: d.isActive ? "var(--flow-active-border)" : "var(--flow-call-handle)" }}
        className="!w-2.5 !h-2.5"
      />
      <div className="flex items-center justify-center gap-1">
        <span style={{ color: d.isActive ? "var(--flow-active-border)" : "var(--flow-call-title)" }}>↻</span>
        <span className="truncate font-medium">{d.label}</span>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ backgroundColor: d.isActive ? "var(--flow-active-border)" : "var(--flow-call-handle)" }}
        className="!w-2.5 !h-2.5"
      />
    </div>
  );
}
