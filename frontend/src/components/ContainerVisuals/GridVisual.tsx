/**
 * components/ContainerVisuals/GridVisual.tsx — 2D matrix/board visualization.
 *
 * Renders a rectangular grid with heatmap semantics for problems like
 * flood fill, island counting, path tracing, and DP on grids.
 *
 * Supports:
 *   - Heatmap & binary color modes (auto-detected from value range)
 *   - Flood-fill BFS wave animation via changingCells
 *   - Path highlighting via highlightedCells
 *   - Region/island numbering via regionMap
 *   - Cell click → tooltip with row, col, value
 *   - Row virtualization for grids > 50 rows
 */

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useVirtualizedList } from "../../hooks/useVirtualizedList";

// ── Types ────────────────────────────────────────────────────────────────────

interface GridVisualProps {
  /** 2D numeric array — the grid data */
  value: number[][];
  /** Variable name shown in the header */
  name: string;
  /** Cells currently being filled (BFS frontier) — triggers wave animation */
  changingCells?: [number, number][];
  /** Cells to highlight (e.g. traced path, current position) */
  highlightedCells?: [number, number][];
  /** Per-cell region ID for island counting (same ID = same region) */
  regionMap?: number[][];
}

interface CellInfo {
  row: number;
  col: number;
  value: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Width & height of a single cell in px */
const CELL_SIZE = 28;
/** Gap between cells (gap-0.5 = 2px) */
const CELL_GAP = 2;
/** Width reserved for row index labels */
const ROW_HEADER_W = 26;
/** Total height of one virtualized row */
const ROW_TOTAL_H = CELL_SIZE + CELL_GAP + 14;
/** Grids larger than this trigger row-based virtualization */
const GRID_ROW_VIRT_THRESHOLD = 50;

// ── Color helpers ────────────────────────────────────────────────────────────

const COLORS_BINARY = { empty: "#27272a", filled: "#059669" };

/**
 * Heatmap HSL gradient: dark zinc → teal → emerald → amber.
 * Value of 0 always renders as the empty (dark) colour.
 */
function heatmapBg(value: number, maxVal: number): string {
  if (maxVal <= 0 || value <= 0) return COLORS_BINARY.empty;
  const t = Math.min(value / maxVal, 1);
  const hue = 170 - t * 100;   // 170 (teal) → 70 (amber)
  const sat = 50 + t * 30;     // 50 → 80
  const lit = 12 + t * 38;     // 12 → 50
  return `hsl(${hue}, ${sat}%, ${lit}%)`;
}

function heatmapTextColor(value: number, maxVal: number): string {
  if (maxVal <= 0 || value <= 0) return "#a1a1aa"; // zinc-400
  const t = Math.min(value / maxVal, 1);
  // Light text on dark bg, dark text on light bg
  return t > 0.6 ? "#18181b" : "#e4e4e7";
}

// ── Sub-components ───────────────────────────────────────────────────────────

/** Single grid cell */
function GridCell({
  value,
  maxVal,
  isBinary,
  row,
  col,
  isChanging,
  changeIndex,
  isHighlighted,
  regionId,
  onClick,
}: {
  value: number;
  maxVal: number;
  isBinary: boolean;
  row: number;
  col: number;
  isChanging: boolean;
  changeIndex: number;
  isHighlighted: boolean;
  regionId: number | undefined;
  onClick: () => void;
}) {
  const bg = isBinary
    ? value === 0
      ? COLORS_BINARY.empty
      : COLORS_BINARY.filled
    : heatmapBg(value, maxVal);

  const txtColor = isBinary
    ? value === 0
      ? "#a1a1aa"
      : "#d4d4d8"
    : heatmapTextColor(value, maxVal);

  const highlightBorder = isHighlighted ? "2px solid #f59e0b" : undefined;

  const cellContent = (
    <div
      onClick={onClick}
      className="flex items-center justify-center text-[10px] font-mono cursor-pointer rounded-sm select-none"
      style={{
        width: CELL_SIZE,
        height: CELL_SIZE,
        backgroundColor: bg,
        color: txtColor,
        border: highlightBorder,
      }}
      title={`[${row}, ${col}] = ${value}`}
    >
      {regionId !== undefined ? regionId : value}
    </div>
  );

  if (isChanging) {
    return (
      <motion.div
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{
          delay: changeIndex * 0.06,
          duration: 0.35,
          ease: "easeOut",
        }}
      >
        {cellContent}
      </motion.div>
    );
  }

  return cellContent;
}

/** Tooltip popover shown on cell click */
function CellTooltip({
  cell,
  onClose,
}: {
  cell: CellInfo;
  onClose: () => void;
}) {
  return (
    <div className="absolute z-50 top-0 left-0 w-full h-full pointer-events-none">
      <div className="pointer-events-auto absolute top-1 right-1 bg-zinc-900 border border-zinc-600 rounded px-2.5 py-1.5 shadow-lg text-xs font-mono">
        <div className="text-zinc-300">
          <span className="text-zinc-500">row </span>
          {cell.row}
          <span className="text-zinc-500">  col </span>
          {cell.col}
        </div>
        <div className="text-zinc-100 mt-0.5">
          value = <span className="text-amber-400">{cell.value}</span>
        </div>
        <button
          onClick={onClose}
          className="absolute -top-1 -right-1 w-4 h-4 flex items-center justify-center rounded-full bg-zinc-700 text-zinc-400 text-[10px] leading-none hover:bg-zinc-600"
        >
          ×
        </button>
      </div>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export function GridVisual({
  value,
  name,
  changingCells = [],
  highlightedCells = [],
  regionMap,
}: GridVisualProps) {
  // ── Validation ───────────────────────────────────────────────
  const grid: number[][] = useMemo(() => {
    if (!Array.isArray(value) || value.length === 0) return [];
    // Ensure every row is an array (defensive)
    return value.filter(
      (row): row is number[] => Array.isArray(row),
    );
  }, [value]);

  const rows = grid.length;
  const cols = rows > 0 ? grid[0].length : 0;

  // ── Derived data ─────────────────────────────────────────────
  const isBinary = useMemo(() => {
    if (rows === 0) return true;
    return grid.every((row) =>
      row.every((cell) => cell === 0 || cell === 1),
    );
  }, [grid, rows]);

  const maxValue = useMemo(() => {
    if (isBinary || rows === 0) return 1;
    let mx = 0;
    for (const row of grid) {
      for (const cell of row) {
        if (cell > mx) mx = cell;
      }
    }
    return mx || 1;
  }, [grid, isBinary, rows]);

  // Build lookups
  const changingSet = useMemo(() => {
    const s = new Set<string>();
    changingCells.forEach(([r, c]) => s.add(`${r},${c}`));
    return s;
  }, [changingCells]);

  const highlightedSet = useMemo(() => {
    const s = new Set<string>();
    highlightedCells.forEach(([r, c]) => s.add(`${r},${c}`));
    return s;
  }, [highlightedCells]);

  // Compute change index for stagger sorting
  const changeIndexMap = useMemo(() => {
    const m = new Map<string, number>();
    changingCells.forEach(([r, c], i) => {
      const k = `${r},${c}`;
      if (!m.has(k)) m.set(k, i);
    });
    return m;
  }, [changingCells]);

  // ── Tooltip state ────────────────────────────────────────────
  const [selectedCell, setSelectedCell] = useState<CellInfo | null>(null);

  // ── Virtualization ───────────────────────────────────────────
  const needsVirtualization = rows > GRID_ROW_VIRT_THRESHOLD;
  const { parentRef, virtualizer } = useVirtualizedList({
    count: needsVirtualization ? rows : 0,
    itemSize: ROW_TOTAL_H,
    horizontal: false,
  });

  // ── Render helpers ───────────────────────────────────────────

  /** Render a single row of cells */
  function renderRow(rowIdx: number) {
    const row = grid[rowIdx];
    if (!row) return null;
    return (
      <div key={rowIdx} className="flex gap-0.5">
        {/* Row index label */}
        <div
          className="shrink-0 text-[9px] text-zinc-600 font-mono text-right pr-1 leading-[28px]"
          style={{ width: ROW_HEADER_W }}
        >
          {rowIdx}
        </div>

        {/* Cells */}
        {row.map((cellVal, colIdx) => {
          const key = `${rowIdx},${colIdx}`;
          const isChanging = changingSet.has(key);
          const changeIdx = changeIndexMap.get(key) ?? 0;
          const isHighlighted = highlightedSet.has(key);
          const regionId = regionMap?.[rowIdx]?.[colIdx];

          return (
            <GridCell
              key={key}
              value={cellVal}
              maxVal={maxValue}
              isBinary={isBinary}
              row={rowIdx}
              col={colIdx}
              isChanging={isChanging}
              changeIndex={changeIdx}
              isHighlighted={isHighlighted}
              regionId={regionId}
              onClick={() =>
                setSelectedCell({ row: rowIdx, col: colIdx, value: cellVal })
              }
            />
          );
        })}
      </div>
    );
  }

  // ── Empty state ──────────────────────────────────────────────
  if (rows === 0 || cols === 0) {
    return (
      <div className="flex flex-col gap-1">
        <div className="text-xs text-zinc-500">{name}: grid</div>
        <span className="text-[10px] text-zinc-600 italic">∅ empty grid</span>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────
  const modeLabel = isBinary
    ? "binary"
    : `heatmap${maxValue > 1 ? ` (0–${maxValue})` : ""}`;
  const dimLabel = `${rows}×${cols}`;

  return (
    <div className="flex flex-col gap-1 relative">
      {/* Header */}
      <div className="flex items-center gap-2 text-xs">
        <span className="text-zinc-400">{name}: grid</span>
        <span className="text-zinc-600">{dimLabel}</span>
        <span className="text-[10px] text-zinc-600 bg-zinc-800/50 px-1 rounded">
          {modeLabel}
        </span>
      </div>

      {/* Grid area */}
      <div className="relative">
        {/* Column headers */}
        <div className="flex ml-[26px] gap-0.5 mb-0.5">
          {Array.from({ length: cols }, (_, c) => (
            <div
              key={c}
              className="text-[9px] text-zinc-600 font-mono text-center shrink-0"
              style={{ width: CELL_SIZE }}
            >
              {c}
            </div>
          ))}
        </div>

        {/* Non-virtualised grid */}
        {!needsVirtualization && (
          <div className="flex flex-col gap-0.5 overflow-x-auto pb-1">
            {grid.map((_, r) => renderRow(r))}
          </div>
        )}

        {/* Virtualised grid */}
        {needsVirtualization && (
          <div ref={parentRef} className="overflow-y-auto" style={{ maxHeight: 480 }}>
            <div
              style={{
                height: `${virtualizer.getTotalSize()}px`,
                position: "relative",
              }}
            >
              {virtualizer.getVirtualItems().map((virtualItem) => {
                const rowIdx = virtualItem.index;
                return (
                  <div
                    key={rowIdx}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: `${virtualItem.size}px`,
                      transform: `translateY(${virtualItem.start}px)`,
                    }}
                  >
                    {renderRow(rowIdx)}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Tooltip */}
        <AnimatePresence>
          {selectedCell && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
            >
              <CellTooltip
                cell={selectedCell}
                onClose={() => setSelectedCell(null)}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Footer: stats */}
      {regionMap && (
        <div className="text-[10px] text-zinc-600">
          regions:{" "}
          {new Set(regionMap.flat().filter((id) => id > 0)).size}
        </div>
      )}
      {changingCells.length > 0 && (
        <div className="text-[10px] text-zinc-600">
          changing: {changingCells.length} cells
        </div>
      )}
    </div>
  );
}
