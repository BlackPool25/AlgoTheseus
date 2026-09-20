/**
 * utils/treeLayout.ts — Inorder-index layout for binary-tree struct visuals.
 *
 * Replaces the old parent-relative offset scheme (left = offset-1,
 * right = offset+1), where the L→R and R→L paths collided at the same
 * coordinate (e.g. BST 50/30/70/20/40/60/80 painted 40 and 60 on top of
 * each other, hiding 40).
 *
 * Layout: a single counter threads through the recursion; each node claims
 * the next inorder slot (left subtree, then self, then right subtree), so
 * every node gets a unique x. Gaps match the historic renderer:
 *   x = slot * NODE_GAP (50), y = depth * ROW_GAP (60).
 *
 * Data contract (identical to the old StructGraphVisual behavior):
 *   - null / $depth_limit subtrees are omitted (return undefined)
 *   - $cycle nodes render as a leaf labeled "↩" with cycle: true
 *   - labels come from node[labelField] (String(... ?? "?"))
 */

export const NODE_GAP = 50;
export const ROW_GAP = 60;

export interface TreeInput {
  [key: string]: unknown;
}

export interface TreePos {
  x: number;
  y: number;
  label: string;
  cycle?: boolean;
  left?: TreePos;
  right?: TreePos;
}

export interface FlatNode {
  x: number;
  y: number;
  label: string;
  cycle: boolean;
}

export interface FlatEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Lay out a binary tree so no two nodes share a coordinate.
 * Pure: no DOM, no React — safe for unit tests.
 */
export function buildTreeLayout(
  node: TreeInput | null,
  labelField = "val",
  leftField = "left",
  rightField = "right",
): TreePos | undefined {
  let slot = 0;

  function visit(n: TreeInput | null, depth: number): TreePos | undefined {
    if (!n || (n as { $depth_limit?: boolean }).$depth_limit) {
      return undefined;
    }
    if ((n as { $cycle?: boolean }).$cycle) {
      const pos: TreePos = { x: slot * NODE_GAP, y: depth * ROW_GAP, label: "↩", cycle: true };
      slot += 1;
      return pos;
    }
    const label = String(n[labelField] ?? "?");
    const left = visit(n[leftField] as TreeInput | null, depth + 1);
    const pos: TreePos = { x: slot * NODE_GAP, y: depth * ROW_GAP, label };
    slot += 1;
    const right = visit(n[rightField] as TreeInput | null, depth + 1);
    if (left !== undefined) pos.left = left;
    if (right !== undefined) pos.right = right;
    return pos;
  }

  return visit(node, 0);
}

/** Flatten a positioned tree into the node/edge lists the SVG renderer needs. */
export function flattenTree(root: TreePos): { nodes: FlatNode[]; edges: FlatEdge[] } {
  const nodes: FlatNode[] = [];
  const edges: FlatEdge[] = [];

  function collect(n: TreePos): void {
    nodes.push({ x: n.x, y: n.y, label: n.label, cycle: n.cycle === true });
    if (n.left !== undefined) {
      edges.push({ x1: n.x, y1: n.y, x2: n.left.x, y2: n.left.y });
      collect(n.left);
    }
    if (n.right !== undefined) {
      edges.push({ x1: n.x, y1: n.y, x2: n.right.x, y2: n.right.y });
      collect(n.right);
    }
  }
  collect(root);

  return { nodes, edges };
}
