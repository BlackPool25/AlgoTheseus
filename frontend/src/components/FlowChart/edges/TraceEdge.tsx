/**
 * components/FlowChart/edges/TraceEdge.tsx — Animated execution path edge.
 *
 * Active edges (on the current execution path) pulse with an amber glow.
 * Inactive edges are a muted zinc color.
 * Uses React Flow's BaseEdge + EdgeLabelRenderer for clean rendering.
 */

import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react";

export function TraceEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  label,
  data,
  markerEnd,
}: EdgeProps) {
  const edgeData = data as { isActive?: boolean; isUntaken?: boolean } | undefined;
  const isActive = edgeData?.isActive ?? false;
  const isUntaken = edgeData?.isUntaken ?? false;

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: isActive
            ? "var(--viz-accent)"
            : "var(--viz-panel-border)",
          strokeWidth: isActive ? 2.5 : 1.5,
          strokeDasharray: isUntaken && !isActive ? "4 4" : undefined,
          opacity: isUntaken && !isActive ? 0.35 : 1,
          filter: isActive
            ? "drop-shadow(0 0 6px color-mix(in srgb, var(--viz-accent) 70%, transparent))"
            : undefined,
          transition: "stroke 0.2s, stroke-width 0.2s, opacity 0.2s",
        }}
      />
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "all",
            }}
            className={`text-[9px] font-mono px-1.5 py-0.5 rounded border shadow-xs transition-opacity ${
              label === "true"
                ? "bg-emerald-950/90 text-emerald-300 border-emerald-500/50 font-semibold"
                : label === "false"
                ? "bg-rose-950/90 text-rose-300 border-rose-500/50 font-semibold"
                : "bg-viz-body text-viz-ink/60 border-viz-line"
            } ${isUntaken && !isActive ? "opacity-40" : "opacity-100"}`}
          >
            {String(label)}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
