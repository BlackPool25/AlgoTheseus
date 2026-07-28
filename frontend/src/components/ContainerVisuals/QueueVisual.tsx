/**
 * components/ContainerVisuals/QueueVisual.tsx — Queue visualization.
 *
 * Renders a queue as a horizontal row of boxes with front/back arrows.
 * Backend serializes queue as: { front: T, items: T[] }
 *
 * Virtualises items when the count exceeds the threshold.
 */

import {
  useVirtualizedList,
  VIRTUALIZE_THRESHOLD,
} from "../../hooks/useVirtualizedList";

interface QueueData {
  front: unknown;
  items: unknown[];
}

interface Props {
  value: QueueData;
}

/** Estimated width of one queue item in px. */
const ITEM_SIZE = 60;

export function QueueVisual({ value }: Props) {
  const items = value.items ?? [];
  const { parentRef, virtualizer } = useVirtualizedList({
    count: items.length,
    itemSize: ITEM_SIZE,
    horizontal: true,
  });

  /* ── Non-virtualised path (≤ threshold) ── */
  if (items.length <= VIRTUALIZE_THRESHOLD) {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-0.5 overflow-x-auto pb-1">
          {/* Front arrow */}
          <div className="flex flex-col items-center shrink-0">
            <span className="text-[9px] text-blue-400">front</span>
            <span className="text-blue-400 text-xs">→</span>
          </div>

          {items.map((item, i) => (
            <div
              key={i}
              className={`flex items-center justify-center min-w-[32px] h-7 px-1.5 border text-[10px] font-mono shrink-0 ${
                i === 0
                  ? "border-blue-500 bg-blue-500/10 text-blue-300"
                  : "border-zinc-600 bg-zinc-800 text-zinc-300"
              }`}
            >
              {String(item)}
            </div>
          ))}

          {items.length === 0 && (
            <span className="text-[10px] text-zinc-600 italic">empty</span>
          )}

          {/* Back arrow */}
          <div className="flex flex-col items-center shrink-0">
            <span className="text-[9px] text-zinc-500">back</span>
            <span className="text-zinc-500 text-xs">→</span>
          </div>
        </div>
        <span className="text-[9px] text-zinc-600">
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
          <span className="text-[9px] text-blue-400">front</span>
          <span className="text-blue-400 text-xs">→</span>
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
                  className={`flex items-center justify-center min-w-[32px] h-7 px-1.5 border text-[10px] font-mono ${
                    idx === 0
                      ? "border-blue-500 bg-blue-500/10 text-blue-300"
                      : "border-zinc-600 bg-zinc-800 text-zinc-300"
                  }`}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: `${virtualItem.size}px`,
                    transform: `translateX(${virtualItem.start}px)`,
                  }}
                >
                  {String(items[idx])}
                </div>
              );
            })}
          </div>
        </div>

        {/* Back arrow */}
        <div className="flex flex-col items-center shrink-0">
          <span className="text-[9px] text-zinc-500">back</span>
          <span className="text-zinc-500 text-xs">→</span>
        </div>
      </div>
      <span className="text-[9px] text-zinc-600">
        queue · {items.length} items
      </span>
    </div>
  );
}
