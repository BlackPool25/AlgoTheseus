/**
 * utils/dequeItems.ts — Shared deque-value reader.
 *
 * Unwraps the backend `{"_type":"deque","items":[...]}` envelope
 * (tracer.h __ser(deque)) for DequeVisual and the VariableRow diff path.
 * Plain arrays are NOT deque envelopes — they stay `vector`, so this
 * returns null for them. Missing/non-array `items` also returns null;
 * callers render an empty state instead of throwing.
 * Kept here so component files export only components
 * (react-refresh/only-export-components).
 */

/** Items array of a deque envelope, or null when absent/malformed. */
export function dequeItems(value: unknown): unknown[] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record._type !== "deque") return null;
  return Array.isArray(record.items) ? (record.items as unknown[]) : null;
}
