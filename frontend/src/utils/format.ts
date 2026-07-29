/**
 * utils/format.ts — Display-value formatting for container visuals.
 *
 * Provides a single `renderCellValue` function that replaces ad-hoc `String(item)`
 * calls with type-aware rendering that handles null, booleans, arrays, objects,
 * and long strings gracefully.
 */

export function renderCellValue(v: unknown): string {
  if (v === null || v === undefined) return "∅";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return v.length > 20 ? v.slice(0, 20) + "…" : v;
  if (Array.isArray(v)) return `[…${v.length > 0 ? v.length : ""}]`;
  if (typeof v === "object")
    return `{${Object.keys(v as object).slice(0, 3).join(",")}${Object.keys(v as object).length > 3 ? ",…" : ""}}`;
  return String(v);
}
