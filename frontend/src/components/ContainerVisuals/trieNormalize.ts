/**
 * components/ContainerVisuals/trieNormalize.ts — Trie input normalization.
 *
 * Non-component module (satisfies react-refresh/only-export-components):
 * holds `normalizeNode` + `trieNodeIds` shared by TrieVisual and
 * VariableRow step-diffing. No JSX, no component exports.
 */

export interface TrieNodeData {
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

export interface LayoutNode {
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

export const LEVEL_H = 56;
const MAX_VISIBLE_CHILDREN = 40;
const COLLAPSE_DESCENDANT_LIMIT = 800;

// ── Normalize input into a flat list of LayoutNodes ─────────────────────────

export function normalizeNode(
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

/** Path-id set of every node in a serialized trie (for step diffing). */
export function trieNodeIds(value: Record<string, unknown> | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!value || typeof value !== "object") return out;
  const rawRoot = (value._type === "trie" && value.root
    ? (value.root as Record<string, unknown>)
    : value) as Record<string, unknown>;
  const norm = normalizeNode(rawRoot as TrieNodeData, "", 0);
  if (!norm) return out;
  const walk = (n: LayoutNode): void => {
    out.add(n.id);
    for (const c of n.children) walk(c);
  };
  walk(norm);
  return out;
}
