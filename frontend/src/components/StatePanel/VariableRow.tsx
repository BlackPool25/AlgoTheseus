/**
 * components/StatePanel/VariableRow.tsx — One variable with its value.
 *
 * Row treatments (R6): changed → amber flash, added → emerald "new",
 * removed → dimmed ghost with line-through, carried (forward-filled stale
 * snapshot) → dimmed with no badge. Dispatches to the appropriate
 * container visual based on value shape. Falls back to plain text.
 */

import { useContainerType } from "../../hooks/useContainerType";
import { VISUAL_REGISTRY } from "../ContainerVisuals/registry";
import { ErrorBoundary } from "../ContainerVisuals/ErrorBoundary";
import type { HeapDiffShape } from "../ContainerVisuals/HeapPanel";
import { diffIndices, diffKeys, diffMembers } from "../ContainerVisuals/flash";
import { trieNodeIds } from "../ContainerVisuals/trieNormalize";
import { renderCellValue } from "../../utils/format";
import { setItems } from "../../utils/setItems";
import type { RowStatus } from "../../utils/scopeDisplay";


interface Props {
  name: string;
  value: unknown;
  status: RowStatus;
  /** Index to highlight in array-type visuals (e.g. i in a for loop). */
  highlightIndex?: number;
  /** Per-step heap table — feeds currentAddr ($id → addr) for linked lists. */
  heap?: Record<string, unknown> | null;
  /** Per-step per-$id diff — selects the mutated node to highlight. */
  heapDiff?: HeapDiffShape | null;
  /** Previous step's value — diffed cell-by-cell for grid changingCells. */
  prevValue?: unknown;
}

const ROW_STYLE: Record<RowStatus, string> = {
  normal: "",
  changed: "bg-amber-500/15",
  added: "bg-emerald-500/15",
  removed: "opacity-70",
  carried: "",
};

const VALUE_STYLE: Record<RowStatus, string> = {
  normal: "text-viz-ink",
  changed: "text-amber-400",
  added: "text-emerald-400",
  removed: "text-viz-ink/40 line-through",
  carried: "text-viz-ink/60",
};

const BADGE: Record<RowStatus, { label: string; className: string } | null> = {
  normal: null,
  changed: { label: "changed", className: "text-amber-400" },
  added: { label: "new", className: "text-emerald-400" },
  removed: { label: "removed", className: "text-zinc-600" },
  carried: null,
};

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

export function VariableRow({ name, value, status, highlightIndex, heap, heapDiff, prevValue }: Props) {
  const containerKind = useContainerType(value);
  const badge = BADGE[status];

  return (
    <div
      data-testid={`var-row-${name}`}
      className={`flex flex-col gap-1 px-3 py-1.5 border-b border-viz-line/50 ${ROW_STYLE[status]}`}
    >
      {/* Name + status badge */}
      <div className="flex items-center gap-2">
        <span
          className={`text-xs font-mono min-w-[80px] shrink-0 ${
            status === "carried" ? "text-viz-ink/40" : "text-viz-ink/60"
          }`}
        >
          {name}
        </span>
        {badge && (
          <span className={`text-xs shrink-0 ml-auto ${badge.className}`}>{badge.label}</span>
        )}
      </div>

      {/* Value visual */}
      <div className={`text-xs font-mono ${VALUE_STYLE[status]}`}>
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
  if ((kind === "vector" || kind === "stack" || kind === "queue" || kind === "priority_queue") && prevValue !== undefined) {
    const currItems = stackQueueItems(value);
    if (currItems) {
      // Envelope idioms (render-spec §2): length change flashes the
      // boundary cell only (new top / new tail / new front), never the
      // shifted body; same-length steps diff cell-by-cell (sift-swap pair).
      const prevItems = stackQueueItems(prevValue);
      if (prevItems && prevItems.length !== currItems.length) {
        const grown = currItems.length > prevItems.length;
        if (kind === "queue" || kind === "priority_queue") {
          extra.changedIndices = [grown ? currItems.length - 1 : 0];
        } else {
          extra.changedIndices = [0];
        }
      } else {
        const changed = diffIndices(prevItems ?? null, currItems);
        if (changed.length > 0) extra.changedIndices = changed;
      }
    } else if (Array.isArray(value)) {
      const changed = diffIndices(prevValue, value);
      if (changed.length > 0) extra.changedIndices = changed;
    }
  }
  if (kind === "map" && prevValue !== undefined && value && typeof value === "object" && !Array.isArray(value)) {
    const changed = diffKeys(prevValue, value as Record<string, unknown>);
    if (changed.length > 0) extra.changedKeys = changed;
  }
  if (kind === "set" && prevValue !== undefined) {
    const currItems = setItems(value);
    if (currItems) {
      const prevItems = setItems(prevValue);
      const added = diffMembers(prevItems ?? null, currItems);
      if (added.length > 0) extra.changedMembers = added;
    }
  }
  if (kind === "trie" && prevValue !== undefined && value && typeof value === "object") {
    const before = trieNodeIds(prevValue as Record<string, unknown>);
    if (before.size > 0) {
      const now = trieNodeIds(value as Record<string, unknown>);
      const created = [...now].filter((id) => !before.has(id));
      if (created.length > 0) extra.createdIds = created;
    }
  }
  return (
    <ErrorBoundary>
      <Component value={value} name={name} highlightIndex={highlightIndex} {...extra} />
    </ErrorBoundary>
  );
}

/** items array of a { top/front, items } envelope, or null. */
function stackQueueItems(value: unknown): unknown[] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const items = (value as Record<string, unknown>).items;
  return Array.isArray(items) ? items : null;
}
