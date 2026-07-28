/**
 * components/ContainerVisuals/MapVisual.tsx — Key-value table.
 *
 * Virtualises rows when entry count exceeds the threshold.
 */

import {
  useVirtualizedList,
  VIRTUALIZE_THRESHOLD,
} from "../../hooks/useVirtualizedList";

interface Props {
  value: Record<string, unknown>;
  name: string;
}

/** Height of one key-value row in px. */
const ITEM_SIZE = 28;
/** Max height of the scrollable container in virtualised mode. */
const MAX_LIST_HEIGHT = 400;

export function MapVisual({ value, name }: Props) {
  const entries = Object.entries(value);
  const { parentRef, virtualizer } = useVirtualizedList({
    count: entries.length,
    itemSize: ITEM_SIZE,
    horizontal: false,
  });

  /* ── Non-virtualised path (≤ threshold) ── */
  if (entries.length <= VIRTUALIZE_THRESHOLD) {
    return (
      <div className="flex flex-col gap-1">
        <div className="text-xs text-zinc-500">
          {name}: map ({entries.length})
        </div>
        <div className="border border-zinc-700 rounded overflow-hidden">
          {entries.map(([k, v]) => (
            <div key={k} className="flex border-b border-zinc-800 last:border-0">
              <div className="px-2 py-1 text-xs font-mono text-blue-300 border-r border-zinc-700 min-w-[60px]">
                {k}
              </div>
              <div className="px-2 py-1 text-xs font-mono text-zinc-200">
                {String(v)}
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
        {name}: map ({entries.length})
      </div>
      <div
        ref={parentRef}
        className="border border-zinc-700 rounded overflow-y-auto"
        style={{ maxHeight: MAX_LIST_HEIGHT }}
      >
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            position: "relative",
          }}
        >
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const [k, v] = entries[virtualItem.index];
            return (
              <div
                key={k}
                className="flex border-b border-zinc-800"
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: `${virtualItem.size}px`,
                  transform: `translateY(${virtualItem.start}px)`,
                }}
              >
                <div className="px-2 py-1 text-xs font-mono text-blue-300 border-r border-zinc-700 min-w-[60px]">
                  {k}
                </div>
                <div className="px-2 py-1 text-xs font-mono text-zinc-200">
                  {String(v)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
