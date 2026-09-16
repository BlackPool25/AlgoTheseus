/**
 * utils/format.ts — Display-value formatting for container visuals.
 *
 * Provides functions for type-aware rendering that handles null, booleans,
 * floating-point numbers/doubles, arrays, objects, and long strings gracefully.
 */

/** Format double/float numbers cleanly to fit inside compact matrix & visual cells. */
export function formatCompactNumber(num: number): string {
  if (Number.isInteger(num)) return String(num);
  if (Number.isNaN(num)) return "NaN";
  if (!Number.isFinite(num)) return num > 0 ? "∞" : "-∞";
  
  const abs = Math.abs(num);
  // Scientific notation for very large or tiny magnitudes
  if (abs >= 10000 || (abs < 0.001 && abs !== 0)) {
    return num.toExponential(1);
  }
  // Trim redundant trailing zeros, keeping max 3 decimal places
  return Number(num.toFixed(3)).toString();
}

/** Standard full-string formatting for tooltips and fallbacks. */
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

/** Compact rendering optimized for tight 2D DP tables, matrix cells, and vector boxes. */
export function renderCompactCellValue(v: unknown): string {
  if (v === null || v === undefined) return "∅";
  if (typeof v === "boolean") return v ? "T" : "F";
  if (typeof v === "number") return formatCompactNumber(v);
  if (typeof v === "string") return v.length > 6 ? v.slice(0, 5) + "…" : v;
  if (Array.isArray(v)) return `[${v.length}]`;
  if (typeof v === "object") return "{…}";
  return String(v);
}
