/**
 * utils/setItems.ts — Shared set-value readers.
 *
 * Pure code motion from SetVisual.tsx (`asItems`) and
 * StatePanel/VariableRow.tsx (`setItems`): both accept a plain array or
 * the backend `{ _type: "set", values: [...] }` envelope (`items` also
 * accepted for older fixtures). Kept here so component files export only
 * components (react-refresh/only-export-components).
 */

/** Items array of a set value (plain array or envelope); prefers `items`, then `values`. */
export function asItems(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    // Live backend emits {"_type":"set","values":[...]} (tracer.h __ser);
    // older fixtures use `items`. Prefer `items` when both are present.
    const items = record.items;
    if (Array.isArray(items)) return items;
    const values = record.values;
    if (Array.isArray(values)) return values;
  }
  return null;
}

/** items array of a set value (plain array or { _type: "set", items }). */
export function setItems(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    // Live backend emits {"_type":"set","values":[...]} (tracer.h __ser);
    // older fixtures use `items`. Prefer `items` when both are present.
    const items = record.items;
    if (Array.isArray(items)) return items;
    const values = record.values;
    if (Array.isArray(values)) return values;
  }
  return null;
}
