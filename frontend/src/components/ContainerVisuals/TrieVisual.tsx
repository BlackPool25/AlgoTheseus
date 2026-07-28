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

// ── Public types ─────────────────────────────────────────────────────────────

export interface TrieVisualProps {
  /** Serialized trie data — either the root node or { _type:"trie", root:… } */
  value: Record<string, unknown>;
  /** Variable name shown in the header */
  name?: string;
  /** Characters to highlight along the active path (e.g. "cat" highlights c→a→t) */
  highlight?: string;
}

// ── Internal types ───────────────────────────────────────────────────────────

interface TrieNodeData {
  /** Character label for this node (empty string for root) */
  char?: string;
  ch?: string;
  /** Whether this node completes a word */
  isEnd?: boolean;
  is_end?: boolean;
  isWord?: boolean;
  /** Child nodes — either array or map */
  edges?: Record<string, unknown> | unknown[];
  children?: Record<string, unknown> | unknown[];
  [key: string]: unknown;
}

interface LayoutNode {
  id: string;
  char: string;
  isEnd: boolean;
  isRoot: boolean;
  x: number;
  y: number;
  children: LayoutNode[];
  totalDescendants: number;
  collapsed: boolean;
  visibleChildCount: number;
}

interface Edge {
  x1: number; y1: number; x2: number; y2: number;
  label: string;
  highlighted: boolean;
}

interface RenderNode {
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
const LEVEL_H = 56;
const CHILD_GAP = 32;
const LEAF_W = CHILD_GAP;
const MAX_VISIBLE_CHILDREN = 40;
const COLLAPSE_DESCENDANT_LIMIT = 800;
const FONT_SIZE = 10;

// ── Normalize input into a flat list of LayoutNodes ─────────────────────────

function normalizeNode(
  data: TrieNodeData | null | undefined,
  path: string,
  depth: number,
): LayoutNode | null {
  if (!data || typeof data !== "object") return null;
  if ((data as Record<string, unknown>).$cycle) return null;
  if ((data as Record<string, unknown>).$depth_limit) return null;
  if ((data as Record<string, unknown>).$addr) return null;

  const char = String(data.char ?? data.ch ?? "");
  const isEnd = !!(data.isEnd || data.is_end || data.isWord);
  const isRoot = char === "" && depth === 0;

  // Collect children — support both array and map formats
  const childSource: Record<string, unknown> | unknown[] | undefined =
    (data.edges as Record<string, unknown> | unknown[]) ??
    (data.children as Record<string, unknown> | unknown[]);

  const children: LayoutNode[] = [];

  if (childSource) {
    const entries: [string, TrieNodeData][] = [];

    if (Array.isArray(childSource)) {
      childSource.forEach((child, i) => {
        if (child && typeof child === "object") {
          const c = child as TrieNodeData;
          const label = String(c.char ?? c.ch ?? i);
          entries.push([label, c]);
        }
      });
    } else {
      // Map: keys are characters (e.g. "a", "b")
      for (const [key, child] of Object.entries(childSource)) {
        if (child && typeof child === "object") {
          entries.push([key, child as TrieNodeData]);
        }
      }
    }

    for (const [label, childData] of entries) {
      const childPath = path + label;
      const childNode = normalizeNode(childData, childPath, depth + 1);
      if (childNode) {
        children.push(childNode);
      }
    }
  }

  const totalDescendants = children.reduce(
    (sum, c) => sum + 1 + c.totalDescendants, 0,
  );

  // Collapse decision
  const hasManyChildren = children.length > MAX_VISIBLE_CHILDREN;
  const hasDeepDescendants = totalDescendants > COLLAPSE_DESCENDANT_LIMIT;
  const collapsed = hasManyChildren || hasDeepDescendants;

  const visibleChildCount = collapsed
    ? Math.min(children.length, 5) // show first 5 when collapsed
    : children.length;

  return {
    id: path || "root",
    char,
    isEnd,
    isRoot,
    x: 0,
    y: depth * LEVEL_H,
    children,
    totalDescendants,
    collapsed,
    visibleChildCount,
  };
}

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
}: {
  node: RenderNode;
  isHighlighted: boolean;
  index: number;
}) {
  const fill = node.isEnd && !node.isRoot
    ? "#1e3a5f"               // blue-900 for word-end
    : "#1c1917";               // zinc-900 default
  const stroke = node.isRoot
    ? "#a78bfa"               // violet-400 for root
    : isHighlighted
      ? "#f59e0b"             // amber-500 for highlight
      : node.isEnd
        ? "#3b82f6"           // blue-500 for word-end
        : "#78716c";           // zinc-500 default
  const strokeW = isHighlighted || node.isRoot ? 2 : 1.5;
  const textFill = node.isRoot
    ? "#a78bfa"
    : isHighlighted
      ? "#fbbf24"
      : "#e7e5e4";

  // Slightly larger root node
  const r = node.isRoot ? 20 : NODE_R;

  return (
    <g
      transform={`translate(${node.x},${node.y})`}
      style={{
        animation: `trie-node-appear 0.3s ease-out ${index * 0.04}s both`,
      }}
    >
      <circle
        r={r}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeW}
      />
      <text
        textAnchor="middle"
        dominantBaseline="middle"
        fill={textFill}
        fontSize={FONT_SIZE}
        fontFamily="monospace"
        style={{ pointerEvents: "none" }}
      >
        {node.char.length > 3 ? node.char.slice(0, 3) : node.char}
      </text>
      {/* Collapse badge */}
      {node.collapsed && node.overflowCount > 0 && (
        <g>
          <rect
            x={r + 4}
            y={-8}
            width={28}
            height={16}
            rx={3}
            fill="#27272a"
            stroke="#52525b"
            strokeWidth={1}
          />
          <text
            x={r + 18}
            y={2}
            textAnchor="middle"
            fill="#a1a1aa"
            fontSize={8}
            fontFamily="monospace"
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
        stroke={isHighlighted ? "#f59e0b" : "#52525b"}
        strokeWidth={isHighlighted ? 2 : 1.5}
      />
      {/* Edge label background */}
      <rect
        x={midX - 8}
        y={midY - 7}
        width={16}
        height={14}
        rx={2}
        fill="#18181b"
        opacity={0.85}
      />
      <text
        x={midX}
        y={midY + 1}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={isHighlighted ? "#fbbf24" : "#a1a1aa"}
        fontSize={9}
        fontFamily="monospace"
        style={{ pointerEvents: "none" }}
      >
        {edge.label}
      </text>
    </g>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export function TrieVisual({ value, name, highlight }: TrieVisualProps) {
  const svgRef = useRef<SVGSVGElement>(null);

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
        {name && <div className="text-xs text-zinc-500">{name}: trie</div>}
        <span className="text-[10px] text-zinc-600">null / empty</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {/* Header */}
      <div className="flex items-center gap-2">
        {name && (
          <span className="text-xs text-zinc-500">{name}: trie</span>
        )}
        <span className="text-[10px] text-zinc-600">
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
            />
          ))}
        </svg>
      </div>
    </div>
  );
}
