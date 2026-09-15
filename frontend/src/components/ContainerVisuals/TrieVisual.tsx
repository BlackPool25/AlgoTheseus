/**
 * components/ContainerVisuals/TrieVisual.tsx — Prefix tree (trie) visualization.
 *
 * Renders a serialized trie structure as an SVG tree with:
 *   - Circle nodes labelled with characters
 *   - Root node distinguished
 *   - Edges labelled with characters
 *   - Blue fill for word-end (terminal) nodes
 *   - Amber highlight for the active insertion/search path
 *   - Subtree collapse when node/descendant count exceeds thresholds
 *   - CSS fade-in animation for node appearance
 *
 * Input: nested object produced by __serialize_Trie (see useContainerType for detection).
 * Supports both array-of-children and map-of-children serialization formats.
 */

import { useMemo, useRef } from "react";
import {
  LEVEL_H,
  normalizeNode,
  type LayoutNode,
} from "./trieNormalize";

// ── Public types ─────────────────────────────────────────────────────────────

export interface TrieVisualProps {
  /** Serialized trie data — either the root node or { _type:"trie", root:… } */
  value: Record<string, unknown>;
  /** Variable name shown in the header */
  name?: string;
  /** Characters to highlight along the active path (e.g. "cat" highlights c→a→t) */
  highlight?: string;
  /** Node ids created this step (path ids) — creation flash, never whole-tree. */
  createdIds?: string[];
}

// ── Internal types ───────────────────────────────────────────────────────────

interface Edge {
  x1: number; y1: number; x2: number; y2: number;
  label: string;
  highlighted: boolean;
}

interface RenderNode {
  id: string;
  x: number; y: number;
  char: string;
  isRoot: boolean;
  isEnd: boolean;
  highlighted: boolean;
  collapsed: boolean;
  overflowCount: number;
}

// ── Layout constants ─────────────────────────────────────────────────────────

const NODE_R = 16;
const CHILD_GAP = 32;
const LEAF_W = CHILD_GAP;
const FONT_SIZE = 10;

// ── Layout: compute x positions recursively ────────────────────────────────

/**
 * Lays out the subtree rooted at `node`.
 * Returns the rightmost x-coordinate consumed (for sibling placement).
 */
function layoutNode(node: LayoutNode, xStart: number, depth: number): number {
  node.y = depth * LEVEL_H;

  const visibleChildren = node.collapsed
    ? node.children.slice(0, node.visibleChildCount)
    : node.children;

  if (visibleChildren.length === 0) {
    node.x = xStart + LEAF_W / 2;
    return xStart + LEAF_W;
  }

  // Layout each visible child
  let cursor = xStart;
  for (const child of visibleChildren) {
    cursor = layoutNode(child, cursor, depth + 1);
  }

  // Center parent above children
  const firstX = visibleChildren[0].x;
  const lastX = visibleChildren[visibleChildren.length - 1].x;
  node.x = (firstX + lastX) / 2;

  // Account for collapsed overflow indicator
  if (node.collapsed && node.children.length > node.visibleChildCount) {
    cursor += LEAF_W; // space for "+N" indicator
  }

  return Math.max(cursor, node.x + LEAF_W / 2);
}

/**
 * Mark nodes along a highlight path.
 * E.g. highlight="cat" marks the chain: root→c→a→t
 */
function applyHighlight(
  root: LayoutNode,
  highlight: string,
): Set<string> {
  const highlightSet = new Set<string>();
  if (!highlight) return highlightSet;

  let current: LayoutNode = root;
  highlightSet.add(current.id);

  for (let i = 0; i < highlight.length; i++) {
    const ch = highlight[i];
    const next: LayoutNode | undefined = current.children.find((c) => c.char === ch);
    if (!next) break;
    highlightSet.add(next.id);
    current = next;
  }

  return highlightSet;
}

// ── SVG sub-components ──────────────────────────────────────────────────────

const nodeAppearKeyframes = `
@keyframes trie-node-appear {
  from { opacity: 0; transform: scale(0); }
  to   { opacity: 1; transform: scale(1); }
}
@keyframes trie-edge-appear {
  from { opacity: 0; }
  to   { opacity: 1; }
}
`;

function TrieNodeSVG({
  node,
  isHighlighted,
  index,
  created,
}: {
  node: RenderNode;
  isHighlighted: boolean;
  index: number;
  created: boolean;
}) {
  const fill = node.isEnd && !node.isRoot
    ? "var(--viz-panel-bg)"
    : "var(--viz-panel-bg)";
  const stroke = node.isRoot
    ? "var(--viz-accent)"
    : isHighlighted
      ? "var(--viz-flash)"
      : node.isEnd
        ? "var(--viz-alias-edge)"
        : "var(--viz-panel-border)";
  const strokeW = isHighlighted || node.isRoot ? 2 : 1.5;
  const textFill = node.isRoot
    ? "var(--viz-accent)"
    : isHighlighted
      ? "var(--viz-flash)"
      : "var(--viz-body-text)";

  // Slightly larger root node
  const r = node.isRoot ? 20 : NODE_R;

  return (
    <g
      transform={`translate(${node.x},${node.y})`}
      style={{
        animation: `trie-node-appear 0.3s ease-out ${index * 0.04}s both`,
      }}
      data-testid="trie-node"
      data-terminal={node.isEnd && !node.isRoot ? "true" : "false"}
      data-flash={created ? "true" : "false"}
    >
      <circle
        r={r}
        strokeWidth={created ? 2.5 : strokeW}
        style={{ fill, stroke: created ? "var(--viz-flash)" : stroke }}
      />
      <text
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={FONT_SIZE}
        fontFamily="monospace"
        style={{ pointerEvents: "none", fill: textFill }}
      >
        {node.char.length > 3 ? node.char.slice(0, 3) : node.char}
      </text>
      {/* Terminal badge: word-end marker (render-spec §2 trie idiom) */}
      {node.isEnd && !node.isRoot && (
        <g>
          <circle
            cx={r - 4}
            cy={-r + 4}
            r={6}
            style={{ fill: "var(--viz-alias-edge)" }}
          />
          <text
            x={r - 4}
            y={-r + 4}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={8}
            fontFamily="monospace"
            style={{ fill: "var(--viz-body-bg)", pointerEvents: "none" }}
          >
            ✓
          </text>
        </g>
      )}
      {/* Collapse badge */}
      {node.collapsed && node.overflowCount > 0 && (
        <g>
          <rect
            x={r + 4}
            y={-8}
            width={28}
            height={16}
            rx={3}
            stroke="var(--viz-panel-border)"
            strokeWidth={1}
            style={{ fill: "var(--viz-panel-bg)" }}
          />
          <text
            x={r + 18}
            y={2}
            textAnchor="middle"
            fontSize={8}
            fontFamily="monospace"
            style={{ fill: "var(--viz-alias-edge)" }}
          >
            +{node.overflowCount > 99 ? "99+" : node.overflowCount}
          </text>
        </g>
      )}
    </g>
  );
}

function TrieEdgeSVG({
  edge,
  isHighlighted,
  index,
}: {
  edge: Edge;
  isHighlighted: boolean;
  index: number;
}) {
  const midX = (edge.x1 + edge.x2) / 2;
  const midY = (edge.y1 + edge.y2) / 2;

  return (
    <g
      style={{
        animation: `trie-edge-appear 0.25s ease-out ${index * 0.03 + 0.1}s both`,
      }}
    >
      <line
        x1={edge.x1} y1={edge.y1}
        x2={edge.x2} y2={edge.y2}
        strokeWidth={isHighlighted ? 2 : 1.5}
        style={{ stroke: isHighlighted ? "var(--viz-flash)" : "var(--viz-panel-border)" }}
      />
      {/* Edge label background */}
      <rect
        x={midX - 8}
        y={midY - 7}
        width={16}
        height={14}
        rx={2}
        opacity={0.85}
        style={{ fill: "var(--viz-body-bg)" }}
      />
      <text
        x={midX}
        y={midY + 1}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={9}
        fontFamily="monospace"
        style={{ pointerEvents: "none", fill: isHighlighted ? "var(--viz-flash)" : "var(--viz-alias-edge)" }}
      >
        {edge.label}
      </text>
    </g>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export function TrieVisual({ value, name, highlight, createdIds = [] }: TrieVisualProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const created = new Set(createdIds);

  const {
    root,
    renderNodes,
    renderEdges,
    svgWidth,
    svgHeight,
    nodeCount,
  } = useMemo(() => {
    // Parse input — support both { _type:"trie", root:{…} } and bare root node
    const rawRoot: Record<string, unknown> =
      (value._type === "trie" && value.root
        ? (value.root as Record<string, unknown>)
        : value) ?? {};

    const norm = normalizeNode(rawRoot, "", 0);
    if (!norm) {
      return {
        root: null,
        renderNodes: [],
        renderEdges: [],
        svgWidth: 0,
        svgHeight: 0,
        nodeCount: 0,
      };
    }

    // Layout (positions are set as side-effect on norm)
    layoutNode(norm, 0, 0);

    // Highlight
    const highlightSet = applyHighlight(norm, highlight ?? "");

    // Collect render data
    function collect(
      n: LayoutNode,
      nodesAcc: RenderNode[],
      edgesAcc: Edge[],
    ) {
      const isHL = highlightSet.has(n.id);
      nodesAcc.push({
        id: n.id,
        x: n.x,
        y: n.y,
        char: n.isRoot ? "root" : n.char,
        isRoot: n.isRoot,
        isEnd: n.isEnd,
        highlighted: isHL,
        collapsed: n.collapsed,
        overflowCount: n.collapsed
          ? Math.max(0, n.children.length - n.visibleChildCount)
          : 0,
      });

      const visibleChildren = n.collapsed
        ? n.children.slice(0, n.visibleChildCount)
        : n.children;

      for (const child of visibleChildren) {
        const childHL = highlightSet.has(child.id);
        edgesAcc.push({
          x1: n.x, y1: n.y + (n.isRoot ? 20 : NODE_R),
          x2: child.x, y2: child.y - NODE_R,
          label: child.char,
          highlighted: childHL,
        });
        collect(child, nodesAcc, edgesAcc);
      }
    }

    const nodesAcc: RenderNode[] = [];
    const edgesAcc: Edge[] = [];
    collect(norm, nodesAcc, edgesAcc);

    // SVG dimensions
    const pad = 30;
    const maxX = Math.max(...nodesAcc.map((n) => n.x), 0);
    const maxY = Math.max(...nodesAcc.map((n) => n.y), 0);
    const width = Math.max(maxX + pad * 2, 120);
    const height = Math.max(maxY + pad * 2 + NODE_R, 80);

    const rootOverflow = norm.collapsed
      ? Math.max(0, norm.children.length - norm.visibleChildCount)
      : 0;
    const svgWidth = width + (rootOverflow > 0 ? 40 : 0);

    return {
      root: norm,
      renderNodes: nodesAcc,
      renderEdges: edgesAcc,
      svgWidth,
      svgHeight: height,
      nodeCount: nodesAcc.length,
    };
  }, [value, highlight]);

  if (!root) {
    return (
      <div className="flex flex-col gap-1">
        {name && <div className="text-xs text-viz-ink/60">{name}: trie</div>}
        <span className="text-[10px] text-viz-ink/60">null / empty</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {/* Header */}
      <div className="flex items-center gap-2">
        {name && (
          <span className="text-xs text-viz-ink/60">{name}: trie</span>
        )}
        <span className="text-[10px] text-viz-ink/60">
          {nodeCount} node{nodeCount !== 1 ? "s" : ""}
        </span>
      </div>

      {/* SVG tree */}
      <div className="overflow-auto max-w-full">
        <style>{nodeAppearKeyframes}</style>
        <svg
          ref={svgRef}
          width={svgWidth}
          height={svgHeight}
          className="overflow-visible"
        >
          {/* Edges */}
          {renderEdges.map((edge, i) => (
            <TrieEdgeSVG
              key={`e-${i}`}
              edge={edge}
              isHighlighted={edge.highlighted}
              index={i}
            />
          ))}
          {/* Nodes */}
          {renderNodes.map((node, i) => (
            <TrieNodeSVG
              key={`n-${i}`}
              node={node}
              isHighlighted={node.highlighted}
              index={i}
              created={created.has(node.id)}
            />
          ))}
        </svg>
      </div>
    </div>
  );
}
