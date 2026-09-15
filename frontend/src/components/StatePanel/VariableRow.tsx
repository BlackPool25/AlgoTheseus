/**
 * components/StatePanel/VariableRow.tsx — One variable with its value.
 *
 * Highlights changed values in cyan.
 * Dispatches to the appropriate container visual based on value shape.
 * Falls back to plain text for primitives.
 */

import { useContainerType } from "../../hooks/useContainerType";
import { VISUAL_REGISTRY } from "../ContainerVisuals/registry";
import { ErrorBoundary } from "../ContainerVisuals/ErrorBoundary";
import type { HeapDiffShape } from "../ContainerVisuals/HeapPanel";
import { renderCellValue } from "../../utils/format";


interface Props {
  name: string;
  value: unknown;
  changed: boolean;
  /** Index to highlight in array-type visuals (e.g. mid in binary search). */
  highlightIndex?: number;
  /** Per-step heap table — feeds currentAddr ($id → addr) for linked lists. */
  heap?: Record<string, unknown> | null;
  /** Per-step per-$id diff — selects the mutated node to highlight. */
  heapDiff?: HeapDiffShape | null;
  /** Previous step's value — diffed cell-by-cell for grid changingCells. */
  prevValue?: unknown;
}

/** $id of a linked-list head value, when present. */
function headId(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = (value as Record<string, unknown>).$id;
  return typeof id === "number" && !Number.isNaN(id) ? String(id) : null;
}

/** $addr for a heap id, when the table carries one. */
function heapAddr(heap: Record<string, unknown> | null | undefined, id: string): string | undefined {
  const raw = heap?.[id];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const addr = (raw as Record<string, unknown>).addr;
  return typeof addr === "string" ? addr : undefined;
}

/**
 * T12 (R6.5): derive the linked-list highlight address from the heap table.
 * The first mutated $id whose addr exists wins (amber flash on the mutated
 * node alone); otherwise no highlight — never the whole structure.
 */
function deriveCurrentAddr(
  value: unknown,
  heap: Record<string, unknown> | null | undefined,
  heapDiff: HeapDiffShape | null | undefined,
): string | undefined {
  if (!heap || headId(value) === null) return undefined;
  const mutated = Array.isArray(heapDiff?.mutated) ? heapDiff.mutated : [];
  for (const id of mutated) {
    const addr = heapAddr(heap, String(id));
    if (addr !== undefined) return addr;
  }
  return undefined;
}

/** True 2D numeric grid check (mirrors useContainerType's grid branch). */
function asGrid(value: unknown): number[][] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  if (!value.every((row) => Array.isArray(row))) return null;
  return value as number[][];
}

/**
 * T12 (R6.5): cell-level diff of a grid against its previous-step value.
 * Returns the changed coordinates, or null when either side is not a
 * same-shaped grid (props stay at their defaults — no visual change).
 */
function diffGridCells(prev: unknown, next: number[][]): [number, number][] | null {
  const prevGrid = asGrid(prev);
  if (!prevGrid || prevGrid.length !== next.length) return null;
  const out: [number, number][] = [];
  for (let r = 0; r < next.length; r++) {
    if (!Array.isArray(prevGrid[r]) || prevGrid[r].length !== next[r].length) return null;
    for (let c = 0; c < next[r].length; c++) {
      if (prevGrid[r][c] !== next[r][c]) out.push([r, c]);
    }
  }
  return out;
}

export function VariableRow({ name, value, changed, highlightIndex, heap, heapDiff, prevValue }: Props) {
  const containerKind = useContainerType(value);

  return (
    <div
      className={`flex flex-col gap-1 px-3 py-1.5 border-b border-viz-line/50 ${
        changed ? "bg-cyan-500/15" : ""
      }`}
    >
      {/* Name + changed badge */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono text-viz-ink/60 min-w-[80px] shrink-0">
          {name}
        </span>
        {changed && (
          <span className="text-xs text-cyan-400 shrink-0 ml-auto">changed</span>
        )}
      </div>

      {/* Value visual */}
      <div className={`text-xs font-mono ${changed ? "text-cyan-400" : "text-viz-ink"}`}>
        <ValueVisual name={name} value={value} kind={containerKind} highlightIndex={highlightIndex} heap={heap} heapDiff={heapDiff} prevValue={prevValue} />
      </div>
    </div>
  );
}

interface ValueVisualProps {
  name: string;
  value: unknown;
  kind: ReturnType<typeof useContainerType>;
  highlightIndex?: number;
  heap?: Record<string, unknown> | null;
  heapDiff?: HeapDiffShape | null;
  prevValue?: unknown;
}

function ValueVisual({ name, value, kind, highlightIndex, heap, heapDiff, prevValue }: ValueVisualProps) {
  const Component = VISUAL_REGISTRY[kind];
  if (!Component) return <span className="break-all">{renderCellValue(value)}</span>;
  const extra: Record<string, unknown> = {};
  if (kind === "linked_list") {
    const addr = deriveCurrentAddr(value, heap, heapDiff);
    if (addr !== undefined) extra.currentAddr = addr;
  }
  if (kind === "grid") {
    const grid = asGrid(value);
    if (grid && prevValue !== undefined) {
      const cells = diffGridCells(prevValue, grid);
      if (cells && cells.length > 0) {
        extra.changingCells = cells;
        extra.highlightedCells = cells;
      }
    }
  }
  return (
    <ErrorBoundary>
      <Component value={value} name={name} highlightIndex={highlightIndex} {...extra} />
    </ErrorBoundary>
  );
}
