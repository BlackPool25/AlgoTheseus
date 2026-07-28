/**
 * components/ContainerVisuals/StructGraphVisual.tsx — Pointer struct visualization.
 *
 * Renders tree/linked-list/graph structures from serialized struct data.
 * Uses a recursive box-and-arrow approach rendered as SVG.
 *
 * Input: a nested object produced by the generated __serialize_TypeName function.
 * The render_as field from the schema determines layout:
 *   - "tree": binary tree layout (left/right children)
 *   - "linked_list": horizontal chain
 *   - "graph": force-directed (simplified: just show as tree)
 */

import { useMemo } from "react";

export type RenderAs = "tree" | "linked_list" | "graph";

interface StructNode {
  [key: string]: unknown;
}

interface Props {
  value: StructNode | null;
  renderAs: RenderAs;
  labelField?: string;   // which field to show as the node label
  leftField?: string;    // for trees: left child field name
  rightField?: string;   // for trees: right child field name
  nextField?: string;    // for linked lists: next pointer field name
}

// ── Tree layout ───────────────────────────────────────────────────────────────

interface TreePos {
  x: number;
  y: number;
  label: string;
  left?: TreePos;
  right?: TreePos;
}

function buildTreeLayout(
  node: StructNode | null,
  labelField: string,
  leftField: string,
  rightField: string,
  depth = 0,
  offset = 0
): TreePos | undefined {
  if (!node || (node as { $cycle?: boolean }).$cycle || (node as { $depth_limit?: boolean }).$depth_limit) {
    return undefined;
  }
  const label = String(node[labelField] ?? "?");
  const left = buildTreeLayout(node[leftField] as StructNode | null, labelField, leftField, rightField, depth + 1, offset - 1);
  const right = buildTreeLayout(node[rightField] as StructNode | null, labelField, leftField, rightField, depth + 1, offset + 1);
  return { x: offset * 50, y: depth * 60, label, left, right };
}

function TreeSVG({ root }: { root: TreePos }) {
  const nodes: { x: number; y: number; label: string }[] = [];
  const edges: { x1: number; y1: number; x2: number; y2: number }[] = [];

  function collect(n: TreePos) {
    nodes.push({ x: n.x, y: n.y, label: n.label });
    if (n.left) {
      edges.push({ x1: n.x, y1: n.y, x2: n.left.x, y2: n.left.y });
      collect(n.left);
    }
    if (n.right) {
      edges.push({ x1: n.x, y1: n.y, x2: n.right.x, y2: n.right.y });
      collect(n.right);
    }
  }
  collect(root);

  // Normalize to positive coords
  const minX = Math.min(...nodes.map((n) => n.x));
  const minY = Math.min(...nodes.map((n) => n.y));
  const maxX = Math.max(...nodes.map((n) => n.x));
  const maxY = Math.max(...nodes.map((n) => n.y));
  const W = maxX - minX + 60;
  const H = maxY - minY + 60;

  const tx = (x: number) => x - minX + 30;
  const ty = (y: number) => y - minY + 30;

  return (
    <svg width={W} height={H} className="overflow-visible">
      {edges.map((e, i) => (
        <line
          key={i}
          x1={tx(e.x1)} y1={ty(e.y1)}
          x2={tx(e.x2)} y2={ty(e.y2)}
          stroke="#52525b" strokeWidth={1.5}
          markerEnd="url(#arrow)"
        />
      ))}
      <defs>
        <marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <path d="M0,0 L0,6 L6,3 z" fill="#52525b" />
        </marker>
      </defs>
      {nodes.map((n, i) => (
        <g key={i} transform={`translate(${tx(n.x)},${ty(n.y)})`}>
          <circle r={16} fill="#1c1917" stroke="#78716c" strokeWidth={1.5} />
          <text textAnchor="middle" dominantBaseline="middle" fill="#e7e5e4" fontSize={10} fontFamily="monospace">
            {n.label.length > 4 ? n.label.slice(0, 4) : n.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

// ── Linked list layout ────────────────────────────────────────────────────────

function LinkedListSVG({ nodes }: { nodes: string[] }) {
  const W = nodes.length * 60 + 20;
  return (
    <svg width={W} height={50}>
      {nodes.map((label, i) => (
        <g key={i} transform={`translate(${i * 60 + 10}, 10)`}>
          <rect width={40} height={30} rx={3} fill="#1c1917" stroke="#78716c" strokeWidth={1.5} />
          <text x={20} y={19} textAnchor="middle" fill="#e7e5e4" fontSize={10} fontFamily="monospace">
            {label.length > 4 ? label.slice(0, 4) : label}
          </text>
          {i < nodes.length - 1 && (
            <line x1={40} y1={15} x2={60} y2={15} stroke="#52525b" strokeWidth={1.5} markerEnd="url(#arrow2)" />
          )}
        </g>
      ))}
      <defs>
        <marker id="arrow2" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <path d="M0,0 L0,6 L6,3 z" fill="#52525b" />
        </marker>
      </defs>
    </svg>
  );
}

function collectLinkedList(node: StructNode | null, labelField: string, nextField: string, max = 20): string[] {
  const result: string[] = [];
  let cur = node;
  const seen = new Set<unknown>();
  while (cur && result.length < max) {
    if ((cur as { $cycle?: boolean }).$cycle) { result.push("↩"); break; }
    if (seen.has(cur)) break;
    seen.add(cur);
    result.push(String(cur[labelField] ?? "?"));
    cur = cur[nextField] as StructNode | null;
  }
  return result;
}

// ── Main component ────────────────────────────────────────────────────────────

export function StructGraphVisual({
  value,
  renderAs,
  labelField = "val",
  leftField = "left",
  rightField = "right",
  nextField = "next",
}: Props) {
  const content = useMemo(() => {
    if (!value) return <span className="text-[10px] text-zinc-600">null</span>;

    if (renderAs === "linked_list") {
      const nodes = collectLinkedList(value, labelField, nextField);
      return <LinkedListSVG nodes={nodes} />;
    }

    // tree or graph — use tree layout
    const root = buildTreeLayout(value, labelField, leftField, rightField);
    if (!root) return <span className="text-[10px] text-zinc-600">null</span>;
    return <TreeSVG root={root} />;
  }, [value, renderAs, labelField, leftField, rightField, nextField]);

  return (
    <div className="overflow-auto max-w-full">
      {content}
    </div>
  );
}
