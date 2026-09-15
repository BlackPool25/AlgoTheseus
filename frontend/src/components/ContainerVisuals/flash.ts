/**
 * components/ContainerVisuals/flash.ts — ONE shared changed-cell flash
 * primitive (todo 25, render-spec §2 "changed-cell flash primitive").
 *
 * Reused by VectorVisual, StackVisual, QueueVisual and HeapVisual (array
 * strip) so every strip idiom flashes identically: token-only
 * `--viz-flash` border + glow, never a hardcoded color.
 *
 * Data-attr contract (asserted by tests/task25-idioms.spec.ts):
 *   data-testid="changed-cell" data-index=<n> data-flash="true|false"
 */

import type { CSSProperties } from "react";

/** Token-only flash border + glow. No hex — docs/theme-tokens.md §1. */
export function flashStyle(changed: boolean): CSSProperties {
  if (!changed) return {};
  return {
    borderColor: "var(--viz-flash)",
    boxShadow: "0 0 6px rgba(245, 158, 11, 0.4)",
  };
}

/** Token-only flash background wash for table rows / chips. */
export function flashRowStyle(changed: boolean): CSSProperties {
  if (!changed) return {};
  return {
    borderColor: "var(--viz-flash)",
    backgroundColor: "rgba(245, 158, 11, 0.12)",
  };
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Cell-by-cell diff of two arrays. Returns indices whose values differ,
 * plus appended indices (growth counts as change on the new cells).
 * Null/absent prev → [] (creation flash is handled by the caller via
 * explicit changedIndices, never whole-value flash).
 */
export function diffIndices(prev: unknown, curr: unknown[]): number[] {
  if (!Array.isArray(prev)) return [];
  const out: number[] = [];
  for (let i = 0; i < curr.length; i++) {
    if (i >= prev.length || !same(prev[i], curr[i])) out.push(i);
  }
  return out;
}

/** Key-level diff of two plain objects. Returns added/changed keys. */
export function diffKeys(
  prev: unknown,
  curr: Record<string, unknown>,
): string[] {
  if (!prev || typeof prev !== "object" || Array.isArray(prev)) return [];
  const p = prev as Record<string, unknown>;
  return Object.keys(curr).filter((k) => !(k in p) || !same(p[k], curr[k]));
}

/**
 * Member-level diff of two arrays by value. Returns values present in
 * curr but absent from prev (insert flash).
 */
export function diffMembers(prev: unknown, curr: unknown[]): unknown[] {
  if (!Array.isArray(prev)) return [];
  const before = new Set(prev.map((v) => JSON.stringify(v)));
  return curr.filter((v) => !before.has(JSON.stringify(v)));
}
