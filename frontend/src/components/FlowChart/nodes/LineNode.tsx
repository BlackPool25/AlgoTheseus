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
        backgroundColor: "var(--viz-panel-bg)",
        borderColor: "var(--viz-panel-border)",
        color: "var(--viz-body-text)",
      };

  return (
    <div
      title={d.label}
      style={{ width: 260, height: 68, ...containerStyle }}
      className={`relative px-3 py-2 rounded-lg border text-left flex flex-col justify-center transition-all shadow-xs select-none ${
        d.isUntaken && !d.isActive ? "border-dashed opacity-45" : ""
      }`}
    >
      <Handle
        type="target"
        position={Position.Top}
        style={{
          backgroundColor: d.isActive
            ? "var(--flow-active-border)"
            : "var(--viz-panel-border)",
        }}
        className="!w-2.5 !h-2.5"
      />

      {/* Top Header Row */}
      <div className="flex items-center justify-between gap-1 text-[10px] font-mono leading-none mb-1 opacity-75">
        <span
          style={{
            color: d.isActive
              ? "var(--flow-active-border)"
              : "var(--viz-body-text)",
          }}
          className="font-semibold uppercase tracking-wider text-[9px]"
        >
          Statement
        </span>
        {lineBadge && (
          <span
            style={{
              backgroundColor: "var(--viz-body-bg)",
              borderColor: "var(--viz-panel-border)",
              color: d.isActive
                ? "var(--flow-active-text)"
                : "var(--viz-body-text)",
            }}
            className="px-1 py-0.5 rounded border text-[9px]"
          >
            {lineBadge}
          </span>
        )}
      </div>

      {/* Main Statement Label / Code Lines */}
      <div className="font-mono text-[11px] leading-tight space-y-0.5 overflow-hidden">
        {codeLines.slice(0, 2).map((line, idx) => (
          <div
            key={idx}
            style={{
              color: d.isActive
                ? "var(--flow-active-text)"
                : d.isUntaken
                ? "var(--flow-untaken-text)"
                : "var(--viz-body-text)",
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
                : "var(--viz-body-text)",
            }}
            className="text-[9px] italic truncate opacity-70"
          >
            +{codeLines.length - 2} more...
          </div>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        style={{
          backgroundColor: d.isActive
            ? "var(--flow-active-border)"
            : "var(--viz-panel-border)",
        }}
        className="!w-2.5 !h-2.5"
      />
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
