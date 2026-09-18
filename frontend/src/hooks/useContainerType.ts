/**
 * hooks/useContainerType.ts — Determines which visual to render for a variable value.
 *
 * Heuristic: inspect the shape of the serialized value to guess the container type.
 * The backend serializes containers with distinctive shapes:
 *   - vector/deque: plain array renders as vector; deque has its own
 *     {"_type":"deque","items":[...]} envelope (tracer.h __ser(deque))
 *     so front/back semantics survive the wire
 *   - set: { _type: "set", values: [...] } (items accepted for old fixtures)
 *   - string: JSON string renders as indexed char boxes (StringVisual)
 *   - stack: { top: ..., items: [...] }
 *   - queue: { front: ..., items: [...] }
 *   - priority_queue: { top: ..., items: [...] } (same as stack — disambiguate by context)
 *   - map/unordered_map: plain object with string keys, no "top"/"front"/"items"
 *   - struct pointer: object with struct fields (detected by schemaRenderer)
 */

export type ContainerKind =
  | "vector"
  | "deque"
  | "string"
  | "grid"
  | "graph"
  | "dp_table"
  | "stack"
  | "queue"
  | "priority_queue"
  | "map"
  | "set"
  | "struct"
  | "tree"
  | "linked_list"
  | "trie"
  | "dsu"
  | "multi_structure"
  | "primitive"
  | "unknown";

function isParentArrayShape(p: unknown): p is number[] {
  if (!Array.isArray(p) || p.length === 0) return false;
  return p.every(
    (v) => typeof v === "number" && Number.isInteger(v) && v >= 0 && v < p.length,
  );
}

function isRankArrayShape(r: unknown, n: number): r is number[] {
  if (!Array.isArray(r) || r.length !== n) return false;
  return r.every((v) => typeof v === "number" && Number.isInteger(v) && v >= 0);
}

/**
 * isDsuLike — frontend-only DSU gate. Shape alone ({p,r} int arrays) is not
 * semantics: any scoreboard struct classifies as `dsu` without this. Requires
 * ALL of:
 *  1. same-length integer arrays, n > 0;
 *  2. every p[i] in [0, n);
 *  3. roots idempotent: every parent chain resolves to a root r with
 *     p[r] === r within n hops (no cycles, no dangling parents);
 *  4. r entries non-negative integers bounded by n. Bound note: union-by-rank
 *     guarantees rank <= floor(log2(n)), but size-convention DSUs store
 *     component size (up to n) in the same slot — so the bound is permissive
 *     by design (<= n) and real discrimination comes from 5-6;
 *  5. merge evidence: at least one i with p[i] !== i. A fresh/identity parent
 *     array is indistinguishable from a scoreboard — fail closed to struct;
 *  6. singleton roots carry rank 0 (a lone set has rank/size 0).
 */
function isDsuLike(p: unknown, r: unknown): boolean {
  if (!isParentArrayShape(p)) return false;
  const n = p.length;
  if (!isRankArrayShape(r, n)) return false;
  if (r.some((v) => v > n)) return false;

  // 3. every chain lands on an idempotent root.
  for (let i = 0; i < n; i++) {
    let cur = p[i];
    for (let hops = 0; hops < n; hops++) {
      if (p[cur] === cur) break;
      cur = p[cur];
      if (hops === n - 1) return false;
    }
    if (p[cur] !== cur) return false;
  }

  // 5. merge evidence.
  if (p.every((v, i) => v === i)) return false;

  // 6. singleton roots carry rank 0.
  const childCount = new Array<number>(n).fill(0);
  for (const v of p) childCount[v]++;
  for (let i = 0; i < n; i++) {
    if (p[i] === i && childCount[i] === 1 && r[i] !== 0) return false;
  }

  return true;
}

// Pointer-shaped child: a struct object or null (nullptr). Scalars and
// arrays are NOT pointers — this is what keeps {left:1,right:2} out of tree.
function isPointerShaped(v: unknown): boolean {
  return v === null || (typeof v === "object" && !Array.isArray(v));
}

// A scalar label field must exist alongside left/right (e.g. BST `val`).
// Wire keys ($id/$addr/...) are excluded: $addr is a string scalar and
// must not count as a label.
function hasScalarLabel(obj: Record<string, unknown>): boolean {
  return Object.entries(obj).some(
    ([k, v]) =>
      k !== "left" &&
      k !== "right" &&
      !k.startsWith("$") &&
      (typeof v === "string" || typeof v === "number" || typeof v === "boolean"),
  );
}

export function useContainerType(value: unknown): ContainerKind {  if (value === null || value === undefined) return "primitive";
  // JSON strings (palindrome/LCS/...) render as indexed char boxes;
  // numbers/booleans stay primitive.
  if (typeof value === "string") return "string";
  if (typeof value !== "object") return "primitive";

  if (Array.isArray(value)) {
    // 2D array: differentiate grid (rectangular matrix) from graph (jagged adjacency list)
    if (value.length > 0 && value.every((item) => Array.isArray(item))) {
      const firstLen = value[0].length;
      const isRectangular = firstLen > 0 && value.every((item) => item.length === firstLen);
      return isRectangular ? "grid" : "graph";
    }
    return "vector";
  }

  const obj = value as Record<string, unknown>;

  // _type discriminator — backend uses this to disambiguate same-shaped containers
  if ("_type" in obj) {
    if (obj._type === "pq") return "priority_queue";
    if (obj._type === "set") return "set";
    if (obj._type === "deque") return "deque";
    if (obj._type === "dp_table") return "dp_table";
    if (obj._type === "graph") return "graph";
    if (obj._type === "trie") return "trie";
    if (obj._type === "dsu") return "dsu";
    if (obj._type === "multi_structure") return "multi_structure";
  }

  // DSU (union-find) via frontend parent-array detection fallback.
  // Backend serializes DSU through the generic struct path as
  // {"$id", "$addr", "p": [...], "r": [...]} (no _type emitter —
  // deliberate: avoids touching tracer.h/serializer_gen codegen).
  if (isDsuLike(obj.p, obj.r)) {
    return "dsu";
  }

  // Stack: { top, items } — items ordered top-first
  if ("top" in obj && "items" in obj && Array.isArray(obj.items)) return "stack";

  // Queue: { front, items }
  if ("front" in obj && "items" in obj && Array.isArray(obj.items)) return "queue";

  // Tree node (e.g. BST TreeNode): left+right present, BOTH pointer-shaped
  // (object-or-null), AND a scalar label field present. Bare numeric pairs
  // ({left:1,right:2}) fail closed — they are not pointer trees.
  // Sentinel markers ($cycle/$depth_limit) never route to tree.
  if (
    "left" in obj &&
    "right" in obj &&
    !("$cycle" in obj || "$depth_limit" in obj) &&
    isPointerShaped(obj.left) &&
    isPointerShaped(obj.right) &&
    hasScalarLabel(obj)
  ) {
    return "tree";
  }

  // Linked list node: has $addr + 'next' pointer field (but not left/right which is a tree)
  if ("$addr" in obj && "next" in obj && !("left" in obj && "right" in obj)) {
    const nextVal = obj.next;
    if (nextVal === null || (typeof nextVal === "object" && !Array.isArray(nextVal))) {
      return "linked_list";
    }
  }

  // Vector of plain structs (e.g. vector<Edge>): {$addr, items: [{u,v,w}...]}
  // Must NOT steal the linked-list shape ($addr+next without items stays
  // linked_list via the check above) or stack/queue shapes (top/front+items
  // return earlier).
  if ("$addr" in obj && "items" in obj && Array.isArray(obj.items)) {
    if (
      obj.items.every(
        (el) => typeof el === "object" && el !== null && !Array.isArray(el),
      )
    ) {
      return "vector";
    }
  }

  // Opaque pointer address
  if ("$addr" in obj) return "struct";

  // Cycle/depth limit markers
  if ("$cycle" in obj || "$depth_limit" in obj) return "struct";

  // Object with string keys and no special markers → map
  return "map";
}
