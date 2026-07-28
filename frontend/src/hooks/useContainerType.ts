/**
 * hooks/useContainerType.ts — Determines which visual to render for a variable value.
 *
 * Heuristic: inspect the shape of the serialized value to guess the container type.
 * The backend serializes containers with distinctive shapes:
 *   - vector/deque/set/multiset: plain array
 *   - stack: { top: ..., items: [...] }
 *   - queue: { front: ..., items: [...] }
 *   - priority_queue: { top: ..., items: [...] } (same as stack — disambiguate by context)
 *   - map/unordered_map: plain object with string keys, no "top"/"front"/"items"
 *   - struct pointer: object with struct fields (detected by schemaRenderer)
 */

export type ContainerKind =
  | "vector"
  | "grid"
  | "graph"
  | "dp_table"
  | "stack"
  | "queue"
  | "priority_queue"
  | "map"
  | "set"
  | "struct"
  | "linked_list"
  | "trie"
  | "multi_structure"
  | "primitive"
  | "unknown";

export function useContainerType(value: unknown): ContainerKind {
  if (value === null || value === undefined) return "primitive";
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
    if (obj._type === "dp_table") return "dp_table";
    if (obj._type === "graph") return "graph";
    if (obj._type === "trie") return "trie";
    if (obj._type === "multi_structure") return "multi_structure";
  }

  // Stack: { top, items } — items ordered top-first
  if ("top" in obj && "items" in obj && Array.isArray(obj.items)) return "stack";

  // Queue: { front, items }
  if ("front" in obj && "items" in obj && Array.isArray(obj.items)) return "queue";

  // Linked list node: has $addr + 'next' pointer field (but not left/right which is a tree)
  if ("$addr" in obj && "next" in obj && !("left" in obj && "right" in obj)) {
    const nextVal = obj.next;
    if (nextVal === null || (typeof nextVal === "object" && !Array.isArray(nextVal))) {
      return "linked_list";
    }
  }

  // Opaque pointer address
  if ("$addr" in obj) return "struct";

  // Cycle/depth limit markers
  if ("$cycle" in obj || "$depth_limit" in obj) return "struct";

  // Object with string keys and no special markers → map
  return "map";
}
