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
  getSmoothStepPath,
  Position,
  type EdgeProps,
} from "@xyflow/react";

/**
 * Generate a smooth rounded SVG path through an arbitrary sequence of 2D waypoints.
 * Collinear points are kept straight, while turns are rounded with the given borderRadius.
 */
function pointsToPath(points: { x: number; y: number }[], borderRadius = 12): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  if (points.length === 2) {
    return `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)} L ${points[1].x.toFixed(2)} ${points[1].y.toFixed(2)}`;
  }

  // Deduplicate consecutive identical/near-identical points
  const clean: { x: number; y: number }[] = [];
  for (const pt of points) {
    if (clean.length === 0) {
      clean.push(pt);
    } else {
      const prev = clean[clean.length - 1];
      if (Math.hypot(pt.x - prev.x, pt.y - prev.y) > 0.5) {
        clean.push(pt);
      }
    }
  }

  if (clean.length <= 2) {
    return clean.length === 2
      ? `M ${clean[0].x.toFixed(2)} ${clean[0].y.toFixed(2)} L ${clean[1].x.toFixed(2)} ${clean[1].y.toFixed(2)}`
      : clean.length === 1
      ? `M ${clean[0].x.toFixed(2)} ${clean[0].y.toFixed(2)}`
      : "";
  }

  let d = `M ${clean[0].x.toFixed(2)} ${clean[0].y.toFixed(2)}`;

  for (let i = 1; i < clean.length - 1; i++) {
    const prev = clean[i - 1];
    const curr = clean[i];
    const next = clean[i + 1];

    const dx1 = curr.x - prev.x;
    const dy1 = curr.y - prev.y;
    const len1 = Math.hypot(dx1, dy1);

    const dx2 = next.x - curr.x;
    const dy2 = next.y - curr.y;
    const len2 = Math.hypot(dx2, dy2);

    if (len1 === 0 || len2 === 0) continue;

    const cross = dx1 * dy2 - dy1 * dx2;
    if (Math.abs(cross) < 0.01) {
      // Collinear points, continue straight without arc
      continue;
    }

    const r = Math.min(borderRadius, len1 / 2, len2 / 2);

    const startX = curr.x - (dx1 / len1) * r;
    const startY = curr.y - (dy1 / len1) * r;

    const endX = curr.x + (dx2 / len2) * r;
    const endY = curr.y + (dy2 / len2) * r;

    d += ` L ${startX.toFixed(2)} ${startY.toFixed(2)} Q ${curr.x.toFixed(2)} ${curr.y.toFixed(2)} ${endX.toFixed(2)} ${endY.toFixed(2)}`;
  }

  const last = clean[clean.length - 1];
  d += ` L ${last.x.toFixed(2)} ${last.y.toFixed(2)}`;
  return d;
}

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
  const edgeData = data as
    | {
        isActive?: boolean;
        isUntaken?: boolean;
        points?: { x: number; y: number }[];
      }
    | undefined;
  const isActive = edgeData?.isActive ?? false;
  const isUntaken = edgeData?.isUntaken ?? false;

  // Upward back-edges or edges entering side ports use smoothstep with generous radius
  const isBackEdge =
    targetY <= sourceY ||
    targetPosition === Position.Left ||
    sourcePosition === Position.Left;

  let edgePath: string;
  let labelX: number;
  let labelY: number;

  if (isBackEdge) {
    [edgePath, labelX, labelY] = getSmoothStepPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
      borderRadius: 14,
      offset: 28,
    });
  } else if (edgeData?.points && edgeData.points.length > 3) {
    // Multi-rank forward edge routed by Dagre to avoid intermediate obstacles
    const waypoints = [
      { x: sourceX, y: sourceY },
      ...edgeData.points.slice(1, -1),
      { x: targetX, y: targetY },
    ];
    edgePath = pointsToPath(waypoints, 12);
    // Fallback midpoint for non-branch labels
    const midIndex = Math.floor(waypoints.length / 2);
    labelX = waypoints[midIndex].x;
    labelY = waypoints[midIndex].y;
  } else {
    [edgePath, labelX, labelY] = getBezierPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
    });
  }

  // Decision badges (true/false) are anchored near the source handle along departure vector
  // so they stay in the inter-rank gap and never land on top of downstream nodes
  const isBranchBadge = label === "true" || label === "false";
  let badgeX = labelX;
  let badgeY = labelY;

  if (isBranchBadge) {
    switch (sourcePosition) {
      case Position.Bottom:
        badgeX = sourceX;
        badgeY = sourceY + 18;
        break;
      case Position.Right:
        badgeX = sourceX + 22;
        badgeY = sourceY;
        break;
      case Position.Left:
        badgeX = sourceX - 22;
        badgeY = sourceY;
        break;
      case Position.Top:
        badgeX = sourceX;
        badgeY = sourceY - 18;
        break;
      default:
        badgeX = sourceX;
        badgeY = sourceY + 18;
        break;
    }
  }

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
              transform: `translate(-50%, -50%) translate(${badgeX}px,${badgeY}px)`,
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
