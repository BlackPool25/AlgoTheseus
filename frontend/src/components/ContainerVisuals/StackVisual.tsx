/**
 * components/ContainerVisuals/StackVisual.tsx — Vertical stack, top clearly marked.
 *
 * Virtualises items when the count exceeds the threshold.
 */

import {
  useVirtualizedList,
  VIRTUALIZE_THRESHOLD,
} from "../../hooks/useVirtualizedList";

interface StackValue {
  top: unknown;
  items: unknown[];
}

interface Props {
  value: StackValue;
  name: string;
}

/** Height of one stack item in px. */
const ITEM_SIZE = 28;
/** Max height of the scrollable container in virtualised mode. */
const MAX_LIST_HEIGHT = 400;

export function StackVisual({ value, name }: Props) {
  const { parentRef, virtualizer } = useVirtualizedList({
    count: value.items.length,
    itemSize: ITEM_SIZE,
    horizontal: false,
  });

  /* ── Non-virtualised path (≤ threshold) ── */
  if (value.items.length <= VIRTUALIZE_THRESHOLD) {
    return (
      <div className="flex flex-col gap-1">
        <div className="text-xs text-zinc-500">{name}: stack</div>
        <div className="flex flex-col gap-0.5">
          {value.items.map((item, i) => (
            <div
              key={i}
              className={`px-2 py-1 border text-xs font-mono ${
                i === 0
                  ? "border-amber-500 bg-amber-500/10 text-amber-300"
                  : "border-zinc-600 bg-zinc-800 text-zinc-300"
              }`}
            >
              {i === 0 && <span className="text-amber-500 mr-1">top →</span>}
              {String(item)}
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
        {name}: stack ({value.items.length})
      </div>
      <div
        ref={parentRef}
        className="overflow-y-auto"
        style={{ maxHeight: MAX_LIST_HEIGHT }}
      >
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            position: "relative",
          }}
        >
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const idx = virtualItem.index;
            const item = value.items[idx];
            return (
              <div
                key={virtualItem.key}
                className={`px-2 py-1 border text-xs font-mono ${
                  idx === 0
                    ? "border-amber-500 bg-amber-500/10 text-amber-300"
                    : "border-zinc-600 bg-zinc-800 text-zinc-300"
                }`}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: `${virtualItem.size}px`,
                  transform: `translateY(${virtualItem.start}px)`,
                }}
              >
                {idx === 0 && (
                  <span className="text-amber-500 mr-1">top →</span>
                )}
                {String(item)}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
