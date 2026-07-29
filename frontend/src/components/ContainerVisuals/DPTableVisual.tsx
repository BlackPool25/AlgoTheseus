/**
 * components/ContainerVisuals/DPTableVisual.tsx — DP table visualization.
 *
 * Renders a 2D grid of computed DP values with:
 *  – Current cell highlighted (cyan pulse)
 *  – SVG dependency arrows from current cell to dependency cells
 *  – Recurrence formula on hover / tooltip
 *  – Row virtualization for grids > 50 rows
 *  – 1D DP support (flat array → 1 × N grid)
 *
 * Input format (either rich metadata or plain 2D array):
 *   { _type: "dp_table", data: [[...],[...]], current_cell: [r,c], formula: "...", dependencies: [[dr,dc],...] }
 *   or plain number[][] or number[] (1D)
 */

import { useMemo, useState, useCallback } from "react";
import {
  useVirtualizedList,
} from "../../hooks/useVirtualizedList";

// ─── Constants ─────────────────────────────────────────────────────────────────

/** Cell width in px (matches w-8 = 32px). */
const CELL_W = 32;
/** Cell height in px (matches h-7 = 28px). */
const CELL_H = 28;
/** Gap between cells in px (matches gap-0.5 = 2px). */
const CELL_GAP = 2;
/** Width of the row-label column in px. */
const ROW_LABEL_W = 24;
/** Height of the column-header row in px. */
const COL_HDR_H = 18;
/** Virtualize when row count exceeds this threshold. */
const VIRTUALIZE_2D_THRESHOLD = 50;
/** Max height of scrollable container in virtualized mode. */
const MAX_LIST_HEIGHT = 400;

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface DPTableMeta {
  _type?: "dp_table";
  data: number[][];
  current_cell?: [number, number];
  formula?: string;
  dependencies?: [number, number][];
  row_labels?: string[];
  col_labels?: string[];
}

interface Props {
  value: DPTableMeta | number[][] | number[];
  name: string;
}

interface ArrowDesc {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function is2DArray(v: unknown): v is number[][] {
  return Array.isArray(v) && v.length > 0 && Array.isArray(v[0]);
}

function is1DArray(v: unknown): v is number[] {
  return Array.isArray(v) && v.length > 0 && !Array.isArray(v[0]);
}

/** Normalize the input value into a consistent shape for rendering. */
function normalizeTable(value: Props["value"]): {
  data: number[][];
  rows: number;
  cols: number;
  currentCell: [number, number] | null;
  formula: string;
  dependencies: [number, number][];
  rowLabels: string[];
  colLabels: string[];
} {
  let data: number[][];
  let currentCell: [number, number] | null = null;
  let formula = "";
  let dependencies: [number, number][] = [];
  let rowLabels: string[] = [];
  let colLabels: string[] = [];

  if (value && typeof value === "object" && "_type" in value && (value as unknown as Record<string, unknown>)._type === "dp_table") {
    const meta = value as DPTableMeta;
    data = meta.data ?? [];
    if (meta.current_cell) currentCell = meta.current_cell;
    if (meta.formula) formula = meta.formula;
    if (meta.dependencies) dependencies = meta.dependencies;
    if (meta.row_labels) rowLabels = meta.row_labels;
    if (meta.col_labels) colLabels = meta.col_labels;
  } else if (is2DArray(value)) {
    data = value;
  } else if (is1DArray(value)) {
    // 1D DP → wrap as 1 × N grid
    data = [value];
  } else {
    data = [];
  }

  const rows = data.length;
  const cols = rows > 0 ? data[0].length : 0;

  // Auto-generate labels if not provided
  if (rowLabels.length !== rows) {
    rowLabels = Array.from({ length: rows }, (_, i) => String(i));
  }
  if (colLabels.length !== cols) {
    colLabels = Array.from({ length: cols }, (_, i) => String(i));
  }

  return { data, rows, cols, currentCell, formula, dependencies, rowLabels, colLabels };
}

/** Compute the pixel center of a cell. */
function cellCenter(col: number, row: number): { x: number; y: number } {
  return {
    x: ROW_LABEL_W + col * (CELL_W + CELL_GAP) + CELL_W / 2,
    y: COL_HDR_H + row * (CELL_H + CELL_GAP) + CELL_H / 2,
  };
}

/** Get all unique dependency cell absolute coordinates. */
function computeArrows(
  currentCell: [number, number] | null,
  dependencies: [number, number][],
): ArrowDesc[] {
  if (!currentCell || dependencies.length === 0) return [];
  const [cr, cc] = currentCell;
  return dependencies
    .map(([dr, dc]): ArrowDesc | null => {
      const tr = cr + dr; // absolute row of dependency
      const tc = cc + dc; // absolute col of dependency
      if (tr < 0 || tc < 0) return null; // out of bounds
      const from = cellCenter(tc, tr);
      const to = cellCenter(cc, cr);
      return { x1: from.x, y1: from.y, x2: to.x, y2: to.y };
    })
    .filter((a): a is ArrowDesc => a !== null);
}

/** Get absolute coords of dependency cells (for highlighting). */
function getDepCoords(
  currentCell: [number, number] | null,
  dependencies: [number, number][],
): Set<string> {
  const set = new Set<string>();
  if (!currentCell) return set;
  const [cr, cc] = currentCell;
  for (const [dr, dc] of dependencies) {
    const tr = cr + dr;
    const tc = cc + dc;
    if (tr >= 0 && tc >= 0) set.add(`${tr},${tc}`);
  }
  return set;
}

// ─── Grid helper dimensions ────────────────────────────────────────────────────

const gridWidth = (cols: number) =>
  ROW_LABEL_W + cols * (CELL_W + CELL_GAP);
const gridHeight = (rows: number) =>
  COL_HDR_H + rows * (CELL_H + CELL_GAP);

// ─── Component ─────────────────────────────────────────────────────────────────

export function DPTableVisual({ value, name }: Props) {
  const {
    data,
    rows,
    cols,
    currentCell,
    formula,
    dependencies,
    rowLabels,
    colLabels,
  } = useMemo(() => normalizeTable(value), [value]);

  const [hoveredCell, setHoveredCell] = useState<[number, number] | null>(null);

  const needsVirtualize = rows > VIRTUALIZE_2D_THRESHOLD;

  // Virtualize rows
  const { parentRef, virtualizer } = useVirtualizedList({
    count: needsVirtualize ? rows : 0,
    itemSize: CELL_H + CELL_GAP,
    horizontal: false,
  });

  // Compute arrows for non-virtualized path (or visible rows in virtualized)
  const arrows = useMemo(
    () => computeArrows(currentCell, dependencies),
    [currentCell, dependencies],
  );
  const depCoords = useMemo(
    () => getDepCoords(currentCell, dependencies),
    [currentCell, dependencies],
  );

  const isCurrentCell = useCallback(
    (r: number, c: number) =>
      currentCell !== null && currentCell[0] === r && currentCell[1] === c,
    [currentCell],
  );

  const isDepCell = useCallback(
    (r: number, c: number) => depCoords.has(`${r},${c}`),
    [depCoords],
  );

  const handleCellHover = useCallback(
    (r: number, c: number) => setHoveredCell([r, c]),
    [],
  );
  const handleCellLeave = useCallback(() => setHoveredCell(null), []);

  // ── Empty state ──
  if (rows === 0 || cols === 0) {
    return (
      <div className="flex flex-col gap-1">
        <div className="text-xs text-zinc-500">{name}: dp_table</div>
        <span className="text-[10px] text-zinc-600 italic">empty</span>
      </div>
    );
  }

  // ── Render a single cell ──
  function Cell({ r, c, val }: { r: number; c: number; val: number }) {
    const isCurrent = isCurrentCell(r, c);
    const isDep = isDepCell(r, c);
    const isHovered =
      hoveredCell !== null && hoveredCell[0] === r && hoveredCell[1] === c;

    let cellClass =
      "w-8 h-7 flex items-center justify-center text-xs font-mono border rounded-none shrink-0 transition-colors duration-150";

    if (isCurrent) {
      cellClass +=
        " border-cyan-500 bg-cyan-500/15 text-cyan-300 animate-pulse shadow-[0_0_6px_rgba(6,182,212,0.3)]";
    } else if (isDep) {
      cellClass +=
        " border-blue-500 bg-blue-500/10 text-blue-300";
    } else if (isHovered) {
      cellClass +=
        " border-zinc-500 bg-zinc-700 text-zinc-200";
    } else {
      cellClass +=
        " border-zinc-600 bg-zinc-800 text-zinc-200";
    }

    return (
      <div
        className={cellClass}
        onMouseEnter={() => handleCellHover(r, c)}
        onMouseLeave={handleCellLeave}
        title={`[${r}][${c}] = ${val}${isCurrent && formula ? `\n${formula}` : ""}`}
      >
        {val}
      </div>
    );
  }

  // ── Non-virtualized path ──
  if (!needsVirtualize) {
    const totalW = gridWidth(cols);
    const totalH = gridHeight(rows);

    return (
      <div className="flex flex-col gap-1.5">
        {/* Header: name + formula */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500">{name}: dp_table</span>
          <span className="text-[10px] text-zinc-600">
            {rows}×{cols}
          </span>
        </div>
        {formula && (
          <div className="text-[10px] text-zinc-500 font-mono leading-tight">
            {formula}
          </div>
        )}

        {/* Grid + SVG overlay wrapper */}
        <div
          className="relative overflow-x-auto pb-1"
          style={{ maxHeight: MAX_LIST_HEIGHT }}
        >
          {/* Column headers */}
          <div className="flex" style={{ height: COL_HDR_H }}>
            <div
              className="shrink-0"
              style={{ width: ROW_LABEL_W }}
            />
            {colLabels.map((label, c) => (
              <div
                key={c}
                className="flex items-center justify-center text-[10px] text-zinc-600 font-mono shrink-0"
                style={{ width: CELL_W, marginRight: CELL_GAP }}
              >
                {label}
              </div>
            ))}
          </div>

          {/* Grid body */}
          <div className="relative" style={{ width: totalW }}>
            {/* SVG arrow layer */}
            {arrows.length > 0 && (
              <svg
                className="pointer-events-none absolute inset-0 z-10"
                width={totalW}
                height={totalH}
                style={{ overflow: "visible" }}
              >
                <defs>
                  <marker
                    id="dp-arrow"
                    markerWidth="6"
                    markerHeight="6"
                    refX="5"
                    refY="3"
                    orient="auto"
                  >
                    <path d="M0,0 L0,6 L6,3 z" fill="#3b82f6" />
                  </marker>
                </defs>
                {arrows.map((a, i) => (
                  <line
                    key={i}
                    x1={a.x1}
                    y1={a.y1}
                    x2={a.x2}
                    y2={a.y2}
                    stroke="#3b82f6"
                    strokeWidth={1.5}
                    strokeDasharray="3 2"
                    markerEnd="url(#dp-arrow)"
                    opacity={0.8}
                  />
                ))}
              </svg>
            )}

            {/* Rows */}
            {data.map((row, r) => (
              <div key={r} className="flex items-center" style={{ height: CELL_H, marginBottom: CELL_GAP }}>
                <div
                  className="flex items-center justify-end pr-1 text-[10px] text-zinc-600 font-mono shrink-0"
                  style={{ width: ROW_LABEL_W }}
                >
                  {rowLabels[r]}
                </div>
                {row.map((val, c) => (
                  <Cell key={c} r={r} c={c} val={val} />
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Legend */}
        {currentCell && (
          <div className="flex items-center gap-3 text-[9px] text-zinc-600">
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-sm bg-cyan-500/30 border border-cyan-500" />
              current
            </span>
            {dependencies.length > 0 && (
              <span className="flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-sm bg-blue-500/30 border border-blue-500" />
                dependency
              </span>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── Virtualized path ──
  const totalW = gridWidth(cols);

  return (
    <div className="flex flex-col gap-1.5">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-zinc-500">{name}: dp_table</span>
        <span className="text-[10px] text-zinc-600">
          {rows}×{cols} (virtualized)
        </span>
      </div>
      {formula && (
        <div className="text-[10px] text-zinc-500 font-mono leading-tight">
          {formula}
        </div>
      )}

      {/* Scrollable grid */}
      <div
        ref={parentRef}
        className="overflow-y-auto overflow-x-auto"
        style={{ maxHeight: MAX_LIST_HEIGHT }}
      >
        {/* Column headers (fixed at top) */}
        <div className="flex sticky top-0 z-20 bg-zinc-950" style={{ height: COL_HDR_H }}>
          <div
            className="shrink-0"
            style={{ width: ROW_LABEL_W }}
          />
          {colLabels.map((label, c) => (
            <div
              key={c}
              className="flex items-center justify-center text-[10px] text-zinc-600 font-mono shrink-0"
              style={{ width: CELL_W, marginRight: CELL_GAP }}
            >
              {label}
            </div>
          ))}
        </div>

        {/* Virtualized rows */}
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: totalW,
            position: "relative",
          }}
        >
          {/* SVG arrow layer */}
          {arrows.length > 0 && (
            <svg
              className="pointer-events-none absolute inset-0 z-10"
              width={totalW}
              height={virtualizer.getTotalSize()}
              style={{ overflow: "visible" }}
            >
              <defs>
                <marker
                  id="dp-arrow-v"
                  markerWidth="6"
                  markerHeight="6"
                  refX="5"
                  refY="3"
                  orient="auto"
                >
                  <path d="M0,0 L0,6 L6,3 z" fill="#3b82f6" />
                </marker>
              </defs>
              {arrows.map((a, i) => (
                <line
                  key={i}
                  x1={a.x1}
                  y1={a.y1}
                  x2={a.x2}
                  y2={a.y2}
                  stroke="#3b82f6"
                  strokeWidth={1.5}
                  strokeDasharray="3 2"
                  markerEnd="url(#dp-arrow-v)"
                  opacity={0.8}
                />
              ))}
            </svg>
          )}

          {virtualizer.getVirtualItems().map((virtualRow) => {
            const r = virtualRow.index;
            const row = data[r];
            if (!row) return null;
            return (
              <div
                key={virtualRow.key}
                className="flex items-center"
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <div
                  className="flex items-center justify-end pr-1 text-[10px] text-zinc-600 font-mono shrink-0"
                  style={{ width: ROW_LABEL_W }}
                >
                  {rowLabels[r]}
                </div>
                {row.map((val, c) => (
                  <Cell key={c} r={r} c={c} val={val} />
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      {currentCell && (
        <div className="flex items-center gap-3 text-[9px] text-zinc-600">
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-sm bg-cyan-500/30 border border-cyan-500" />
            current
          </span>
          {dependencies.length > 0 && (
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-sm bg-blue-500/30 border border-blue-500" />
              dependency
            </span>
          )}
        </div>
      )}
    </div>
  );
}
