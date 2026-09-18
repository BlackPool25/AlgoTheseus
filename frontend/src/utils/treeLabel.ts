/**
 * utils/treeLabel.ts — Tree label-field sniffing shared by the registry.
 *
 * Pure code motion from registryComponents.tsx: kept here so that file
 * exports only components (react-refresh/only-export-components).
 */

/** Preferred payload names for a tree node's label, in order. */
export const TREE_LABEL_CANDIDATES = [
  "val",
  "value",
  "data",
  "key",
  "label",
  "name",
];

/** First scalar field outside left/right, ignoring $ wire keys; else "val". */
export function detectTreeLabelField(value: unknown): string {
  const obj = (value ?? {}) as Record<string, unknown>;
  const isScalar = (v: unknown) =>
    typeof v === "string" || typeof v === "number" || typeof v === "boolean";
  for (const k of TREE_LABEL_CANDIDATES) {
    if (k in obj && isScalar(obj[k])) return k;
  }
  for (const [k, v] of Object.entries(obj)) {
    if (k !== "left" && k !== "right" && !k.startsWith("$") && isScalar(v)) {
      return k;
    }
  }
  return "val";
}
