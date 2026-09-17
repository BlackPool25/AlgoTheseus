/**
 * components/ContainerVisuals/VectorVisual.tsx — Horizontal array of index-labelled boxes.
 *
 * Changed-cell flash comes from the shared flash.ts primitive (todo 25).
 * Virtualizes the list when item count exceeds the threshold.
 */

import {
  useVirtualizedList,
  VIRTUALIZE_THRESHOLD,
} from "../../hooks/useVirtualizedList";
import { renderCellValue, renderCompactCellValue } from "../../utils/format";
import { flashStyle } from "./flash";

interface Props {
  value: unknown;
  name: string;
  /** Zero-based index to highlight (e.g. mid in binary search). */
  highlightIndex?: number;
  /** Indices that mutated this step — flash via the shared primitive. */
  changedIndices?: number[];
}

/** Box width (w-8 = 32px) + gap-0.5 (2px) */
const ITEM_SIZE = 34;

/** Unwrap vector items from a plain array or a {$addr, items:[...]} struct-vector shape. */
function extractItems(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value as unknown[];
  if (typeof value === "object" && value !== null) {
    const obj = value as Record<string, unknown>;
    if ("items" in obj && Array.isArray(obj.items)) return obj.items as unknown[];
  }
  return null;
}

/** Metadata keys ($id, $addr, …) are tracer bookkeeping, not struct fields. */
function structEntries(item: unknown): [string, unknown][] {
  if (typeof item !== "object" || item === null || Array.isArray(item)) return [];
  return Object.entries(item as Record<string, unknown>).filter(
    ([k]) => !k.startsWith("$"),
  );
}

export function VectorVisual({ value, name, highlightIndex, changedIndices = [] }: Props) {
  const items = extractItems(value);
  // Unconditional: hooks must run in the same order every render, even for
  // the primitive-fallback path below (count 0 renders nothing virtualised).
  const { parentRef, virtualizer } = useVirtualizedList({
    count: items?.length ?? 0,
    itemSize: ITEM_SIZE,
    horizontal: true,
  });
  if (!items) {
    return (
      <div className="flex flex-col gap-1">
        <div className="text-xs text-viz-ink/60">{name}: vector</div>
        <span data-testid="primitive-fallback" className="text-[10px] text-viz-ink/60 italic">
          {renderCellValue(value)}
        </span>
      </div>
    );
  }
  const changed = new Set(changedIndices);
  /** Returns border/fill classes for an index that may be highlighted. */
  function boxClass(i: number): string {
    const base = "w-8 h-7 flex items-center justify-center text-xs font-mono truncate overflow-hidden border tabular-nums select-none";
    if (changed.has(i)) {
      return `${base} border-viz-flash bg-viz-flash/15 text-viz-flash font-semibold`;
    }
    if (i === highlightIndex) {
      return `${base} border-viz-flash bg-viz-flash/15 text-viz-flash font-semibold`;
    }
    return `${base} border-viz-line bg-viz-panel text-viz-ink`;
  }

  function cellAttrs(i: number) {
    return {
      "data-testid": "changed-cell",
      "data-index": String(i),
      "data-flash": changed.has(i) ? "true" : "false",
    };
  }

  /** Row classes for struct elements — same highlight language as boxClass. */
  function rowClass(i: number): string {
    const base = "flex items-center gap-1.5 px-1.5 h-7 text-xs font-mono truncate overflow-hidden border tabular-nums select-none min-w-0";
    if (changed.has(i)) {
      return `${base} border-viz-flash bg-viz-flash/15 text-viz-flash font-semibold`;
    }
    if (i === highlightIndex) {
      return `${base} border-viz-flash bg-viz-flash/15 text-viz-flash font-semibold`;
    }
    return `${base} border-viz-line bg-viz-panel text-viz-ink`;
  }

  /* ── Struct-element path: one index-labelled row per object element ── */
  const allPrimitive = items.every((item) => typeof item !== "object" || item === null);
  if (!allPrimitive) {
    return (
      <div className="flex flex-col gap-1">
        <div className="text-xs text-viz-ink/60">{name}: vector</div>
        <div className="flex flex-col gap-0.5 overflow-x-auto pb-1">
          {items.map((item, i) => {
            const entries = structEntries(item);
            return (
              <div key={i} className="flex items-center gap-1.5 min-w-0">
                <div className={`text-[10px] font-mono w-6 shrink-0 text-right ${i === highlightIndex || changed.has(i) ? "text-viz-flash" : "text-viz-ink/60"}`}>
                  {i}
                </div>
                <div className={rowClass(i)} style={flashStyle(changed.has(i))} title={entries.map(([k, v]) => `${k}=${renderCellValue(v)}`).join(" ") || renderCellValue(item)} {...cellAttrs(i)}>
                  {entries.length > 0
                    ? entries.map(([k, v]) => (
                        <span key={k} className="truncate">
                          <span className="opacity-60">{k}=</span>
                          {renderCompactCellValue(v)}
                        </span>
                      ))
                    : renderCompactCellValue(item)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  /* ── Non-virtualised path (≤ threshold) ── */
  if (items.length <= VIRTUALIZE_THRESHOLD) {
    return (
      <div className="flex flex-col gap-1">
        <div className="text-xs text-viz-ink/60">{name}: vector</div>
        <div className="flex gap-0.5 overflow-x-auto pb-1">
          {items.map((item, i) => (
            <div key={i} className="flex flex-col items-center shrink-0">
              <div className={boxClass(i)} style={flashStyle(changed.has(i))} title={renderCellValue(item)} {...cellAttrs(i)}>
                {renderCompactCellValue(item)}
              </div>
              <div className={`text-[10px] font-mono ${i === highlightIndex || changed.has(i) ? "text-viz-flash" : "text-viz-ink/60"}`}>
                {i}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  /* ── Virtualised path (> threshold) ── */
  return (
    <div className="flex flex-col gap-1">
      <div className="text-xs text-viz-ink/60">
        {name}: vector ({items.length})
      </div>
      <div
        ref={parentRef}
        className="overflow-x-auto pb-1"
      >
        <div
          style={{
            width: `${virtualizer.getTotalSize()}px`,
            position: "relative",
            height: 42 /* box 28px + index text ~14px */,
          }}
        >
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const item = items[virtualItem.index];
            return (
              <div
                key={virtualItem.key}
                className="flex flex-col items-center"
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: `${virtualItem.size}px`,
                  transform: `translateX(${virtualItem.start}px)`,
                }}
              >
                <div className={boxClass(virtualItem.index)} style={flashStyle(changed.has(virtualItem.index))} title={renderCellValue(item)} {...cellAttrs(virtualItem.index)}>
                  {renderCompactCellValue(item)}
                </div>
                <div className={`text-[10px] font-mono ${virtualItem.index === highlightIndex || changed.has(virtualItem.index) ? "text-viz-flash" : "text-viz-ink/60"}`}>
                  {virtualItem.index}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
