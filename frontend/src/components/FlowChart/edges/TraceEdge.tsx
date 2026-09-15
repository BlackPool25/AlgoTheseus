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
  const isActive = (data as { isActive?: boolean } | undefined)?.isActive ?? false;

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
          stroke: isActive ? "var(--viz-accent, #f59e0b)" : "#52525b",
          strokeWidth: isActive ? 2 : 1.5,
          filter: isActive ? "drop-shadow(0 0 4px color-mix(in srgb, var(--viz-accent, #f59e0b) 53%, transparent))" : undefined,
          transition: "stroke 0.2s, stroke-width 0.2s",
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
            className="text-[10px] px-1 rounded bg-viz-body text-viz-ink/60 border border-viz-line"
          >
            {String(label)}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
