/**
 * utils/heapFlash.ts — shared-$id flash check for caller-frame dedup lines.
 *
 * `ids` are $id/$ref identity strings scanned from a frame var value;
 * `mutated` is heapDiff.mutated (string $ids changed on this step).
 * Both sides are strings (heap table keys are strings) — compared strictly,
 * no numeric coercion.
 *
 * Added/removed are deliberately excluded: added nodes have no prior
 * rendered state to change from (creation flash belongs to the row's own
 * added treatment), and removed nodes have nothing left to highlight.
 * Only `mutated` — "the object you were already looking at changed" — flashes.
 */
export function isHeapFlash(
  ids: readonly string[],
  mutated: readonly string[] | null | undefined,
): boolean {
  if (ids.length === 0 || !mutated || mutated.length === 0) return false;
  const changed = new Set(mutated);
  return ids.some((id) => changed.has(id));
}
