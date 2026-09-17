import {
  BaseEdge,
  EdgeLabelRenderer,
  getStraightPath,
  type EdgeProps,
} from "@xyflow/react";

const NODE_R = 20;

/**
 * Clip a straight line from (sx,sy) to (tx,ty) so it starts/ends
 * NODE_R away from each node center — meaning the edge touches the
 * node circumference rather than going through it.
 */
function getClippedPath(
  sx: number, sy: number,
  tx: number, ty: number,
): [string, number, number] {
  const dx = tx - sx;
  const dy = ty - sy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 0.01) return ["", 0, 0];

  const nx = dx / dist;
  const ny = dy / dist;

  const ax = sx + nx * NODE_R;
  const ay = sy + ny * NODE_R;
  const bx = tx - nx * NODE_R;
  const by = ty - ny * NODE_R;

  const [path] = getStraightPath({ sourceX: ax, sourceY: ay, targetX: bx, targetY: by });
  return [path, ax, ay];
}

export function GraphEdge(props: EdgeProps) {
  const [path] = getClippedPath(props.sourceX, props.sourceY, props.targetX, props.targetY);
  const showLabel =
    typeof props.label === "string" || typeof props.label === "number";
  const labelX = (props.sourceX + props.targetX) / 2;
  const labelY = (props.sourceY + props.targetY) / 2;

  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        style={props.style}
        markerEnd={props.markerEnd}
      />
      {showLabel ? (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan text-[9px] font-mono"
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              background: "var(--viz-body-bg)",
              color: "var(--viz-alias-edge)",
              padding: "0 3px",
              borderRadius: 3,
              pointerEvents: "none",
            }}
          >
            {props.label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
