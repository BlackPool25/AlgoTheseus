/**
 * components/ContainerVisuals/QueueVisual.tsx — Queue visualization.
 *
 * Renders a queue as a horizontal row of boxes with front/back arrows.
 * Backend serializes queue as: { front: T, items: T[] }
 * Enqueue/dequeue flash comes from the shared flash.ts primitive (todo 25).
 *
 * Virtualises items when the count exceeds the threshold.
 */

import {
  useVirtualizedList,
  VIRTUALIZE_THRESHOLD,
} from "../../hooks/useVirtualizedList";
import { renderCellValue } from "../../utils/format";
import { flashStyle } from "./flash";

interface QueueData {
  front: unknown;
  items: unknown[];
}

interface Props {
  value: unknown;
  /** Indices that mutated this step — flash via the shared primitive. */
  changedIndices?: number[];
}

/** Estimated width of one queue item in px. */
const ITEM_SIZE = 60;

function asItems(value: unknown): unknown[] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const items = (value as QueueData).items;
  return Array.isArray(items) ? items : null;
}

export function QueueVisual({ value, changedIndices = [] }: Props) {
  const items = asItems(value);
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
        <span data-testid="primitive-fallback" className="text-[10px] text-viz-ink/60 italic">
          {renderCellValue(value)}
        </span>
      </div>
    );
  }
  const changed = new Set(changedIndices);
  function itemClass(i: number): string {
    const base = "flex items-center justify-center min-w-[32px] h-7 px-1.5 border text-[10px] font-mono shrink-0";
    if (changed.has(i)) return `${base} border-viz-flash bg-viz-flash/10 text-viz-flash`;
    if (i === 0) return `${base} border-viz-alias bg-viz-alias/10 text-viz-ink`;
    return `${base} border-viz-line bg-viz-panel text-viz-ink`;
  }

  function itemAttrs(i: number) {
    return {
      "data-testid": "changed-cell",
      "data-index": String(i),
      "data-flash": changed.has(i) ? "true" : "false",
    };
  }

  /* ── Non-virtualised path (≤ threshold) ── */
  if (items.length <= VIRTUALIZE_THRESHOLD) {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-0.5 overflow-x-auto pb-1">
          {/* Front arrow */}
          <div className="flex flex-col items-center shrink-0">
            <span className="text-[9px] text-viz-alias">front</span>
            <span className="text-viz-alias text-xs">→</span>
          </div>

          {items.map((item, i) => (
            <div key={i} className={itemClass(i)} style={flashStyle(changed.has(i))} {...itemAttrs(i)}>
              {renderCellValue(item)}
            </div>
          ))}

          {items.length === 0 && (
            <span className="text-[10px] text-viz-ink/60 italic">empty</span>
          )}

          {/* Back arrow */}
          <div className="flex flex-col items-center shrink-0">
            <span className="text-[9px] text-viz-ink/60">back</span>
            <span className="text-viz-ink/60 text-xs">→</span>
          </div>
        </div>
        <span className="text-[9px] text-viz-ink/60">
          queue · {items.length} items
        </span>
      </div>
    );
  }

  /* ── Virtualised path (> threshold) ── */
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-0.5 pb-1">
        {/* Front arrow */}
        <div className="flex flex-col items-center shrink-0">
          <span className="text-[9px] text-viz-alias">front</span>
          <span className="text-viz-alias text-xs">→</span>
        </div>

        {/* Virtualized items — scrollable container between arrows */}
        <div
          ref={parentRef}
          className="overflow-x-auto"
          style={{ alignSelf: "stretch" }}
        >
          <div
            style={{
              width: `${virtualizer.getTotalSize()}px`,
              position: "relative",
              height: 28,
            }}
          >
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const idx = virtualItem.index;
              return (
                <div
                  key={virtualItem.key}
                  className={itemClass(idx)}
                  {...itemAttrs(idx)}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: `${virtualItem.size}px`,
                    transform: `translateX(${virtualItem.start}px)`,
                    ...flashStyle(changed.has(idx)),
                  }}
                >
                  {renderCellValue(items[idx])}
                </div>
              );
            })}
          </div>
        </div>

        {/* Back arrow */}
        <div className="flex flex-col items-center shrink-0">
          <span className="text-[9px] text-viz-ink/60">back</span>
          <span className="text-viz-ink/60 text-xs">→</span>
        </div>
      </div>
      <span className="text-[9px] text-viz-ink/60">
        queue · {items.length} items
      </span>
    </div>
  );
}
