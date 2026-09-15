/**
 * components/ContainerVisuals/MapVisual.tsx — Key-value table.
 *
 * Changed-key flash comes from the shared flash.ts primitive (todo 25);
 * rehash notes travel in the trace step_desc (rendered by StatePanel).
 * Virtualises rows when entry count exceeds the threshold.
 */

import {
  useVirtualizedList,
  VIRTUALIZE_THRESHOLD,
} from "../../hooks/useVirtualizedList";
import { renderCellValue } from "../../utils/format";
import { flashRowStyle } from "./flash";

interface Props {
  value: unknown;
  name: string;
  /** Keys inserted/updated this step — flash via the shared primitive. */
  changedKeys?: string[];
}

/** Height of one key-value row in px. */
const ITEM_SIZE = 28;
/** Max height of the scrollable container in virtualised mode. */
const MAX_LIST_HEIGHT = 400;

function asEntries(value: unknown): [string, unknown][] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.entries(value as Record<string, unknown>);
}

export function MapVisual({ value, name, changedKeys = [] }: Props) {
  const entries = asEntries(value);
  if (!entries) {
    return (
      <div className="flex flex-col gap-1">
        <div className="text-xs text-viz-ink/60">
          {name}: map
        </div>
        <span data-testid="primitive-fallback" className="text-[10px] text-viz-ink/60 italic">
          {renderCellValue(value)}
        </span>
      </div>
    );
  }
  const changed = new Set(changedKeys);
  const { parentRef, virtualizer } = useVirtualizedList({
    count: entries.length,
    itemSize: ITEM_SIZE,
    horizontal: false,
  });

  function rowAttrs(k: string) {
    return {
      "data-testid": "map-row",
      "data-key": k,
      "data-flash": changed.has(k) ? "true" : "false",
    };
  }

  /* ── Non-virtualised path (≤ threshold) ── */
  if (entries.length <= VIRTUALIZE_THRESHOLD) {
    return (
      <div className="flex flex-col gap-1">
        <div className="text-xs text-viz-ink/60">
          {name}: map ({entries.length})
        </div>
        <div className="border border-viz-line rounded overflow-hidden">
          {entries.map(([k, v]) => (
            <div key={k} className="flex border-b border-viz-line last:border-0" style={flashRowStyle(changed.has(k))} {...rowAttrs(k)}>
              <div className={`px-2 py-1 text-xs font-mono border-r border-viz-line min-w-[60px] ${changed.has(k) ? "text-viz-flash" : "text-viz-alias"}`}>
                {k}
              </div>
              <div className="px-2 py-1 text-xs font-mono text-viz-ink">
                {renderCellValue(v)}
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
        {name}: map ({entries.length})
      </div>
      <div
        ref={parentRef}
        className="border border-viz-line rounded overflow-y-auto"
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
                className="flex border-b border-viz-line"
                {...rowAttrs(k)}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: `${virtualItem.size}px`,
                  transform: `translateY(${virtualItem.start}px)`,
                  ...flashRowStyle(changed.has(k)),
                }}
              >
                <div className={`px-2 py-1 text-xs font-mono border-r border-viz-line min-w-[60px] ${changed.has(k) ? "text-viz-flash" : "text-viz-alias"}`}>
                  {k}
                </div>
                <div className="px-2 py-1 text-xs font-mono text-viz-ink">
                  {renderCellValue(v)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
