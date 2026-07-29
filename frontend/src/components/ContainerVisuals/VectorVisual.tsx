/**
 * components/ContainerVisuals/VectorVisual.tsx — Horizontal array of index-labelled boxes.
 *
 * Virtualizes the list when item count exceeds the threshold.
 */

import {
  useVirtualizedList,
  VIRTUALIZE_THRESHOLD,
} from "../../hooks/useVirtualizedList";
import { renderCellValue } from "../../utils/format";

interface Props {
  value: unknown[];
  name: string;
  /** Zero-based index to highlight (e.g. mid in binary search). */
  highlightIndex?: number;
}

/** Box width (w-8 = 32px) + gap-0.5 (2px) */
const ITEM_SIZE = 34;

export function VectorVisual({ value, name, highlightIndex }: Props) {
  const { parentRef, virtualizer } = useVirtualizedList({
    count: value.length,
    itemSize: ITEM_SIZE,
    horizontal: true,
  });

  /** Returns border/fill classes for an index that may be highlighted. */
  function boxClass(i: number): string {
    const base = "w-8 h-7 flex items-center justify-center text-xs font-mono truncate overflow-hidden";
    if (i === highlightIndex) {
      return `${base} border-amber-500 bg-amber-500/15 text-amber-300 shadow-[0_0_6px_rgba(245,158,11,0.4)]`;
    }
    return `${base} border border-zinc-600 bg-zinc-800 text-zinc-200`;
  }

  /* ── Non-virtualised path (≤ threshold) ── */
  if (value.length <= VIRTUALIZE_THRESHOLD) {
    return (
      <div className="flex flex-col gap-1">
        <div className="text-xs text-zinc-500">{name}: vector</div>
        <div className="flex gap-0.5 overflow-x-auto pb-1">
          {value.map((item, i) => (
            <div key={i} className="flex flex-col items-center shrink-0">
              <div className={boxClass(i)} title={renderCellValue(item)}>
                {renderCellValue(item)}
              </div>
              <div className={`text-[10px] font-mono ${i === highlightIndex ? "text-amber-600" : "text-zinc-600"}`}>
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
      <div className="text-xs text-zinc-500">
        {name}: vector ({value.length})
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
            const item = value[virtualItem.index];
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
                <div className={boxClass(virtualItem.index)} title={renderCellValue(item)}>
                  {renderCellValue(item)}
                </div>
                <div className={`text-[10px] font-mono ${virtualItem.index === highlightIndex ? "text-amber-600" : "text-zinc-600"}`}>
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
