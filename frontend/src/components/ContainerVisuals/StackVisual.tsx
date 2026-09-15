/**
 * components/ContainerVisuals/StackVisual.tsx — Vertical stack, top clearly marked.
 *
 * Push/pop flash comes from the shared flash.ts primitive (todo 25).
 * Virtualises items when the count exceeds the threshold.
 */

import {
  useVirtualizedList,
  VIRTUALIZE_THRESHOLD,
} from "../../hooks/useVirtualizedList";
import { renderCellValue } from "../../utils/format";
import { flashStyle } from "./flash";

interface StackValue {
  top: unknown;
  items: unknown[];
}

interface Props {
  value: unknown;
  name: string;
  /** Indices that mutated this step — flash via the shared primitive. */
  changedIndices?: number[];
}

/** Height of one stack item in px. */
const ITEM_SIZE = 28;
/** Max height of the scrollable container in virtualised mode. */
const MAX_LIST_HEIGHT = 400;

function asItems(value: unknown): unknown[] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const items = (value as StackValue).items;
  return Array.isArray(items) ? items : null;
}

export function StackVisual({ value, name, changedIndices = [] }: Props) {
  const items = asItems(value);
  if (!items) {
    return (
      <div className="flex flex-col gap-1">
        <div className="text-xs text-viz-ink/60">{name}: stack</div>
        <span data-testid="primitive-fallback" className="text-[10px] text-viz-ink/60 italic">
          {renderCellValue(value)}
        </span>
      </div>
    );
  }
  const changed = new Set(changedIndices);
  const { parentRef, virtualizer } = useVirtualizedList({
    count: items.length,
    itemSize: ITEM_SIZE,
    horizontal: false,
  });

  function itemClass(i: number): string {
    const base = "px-2 py-1 border text-xs font-mono";
    if (changed.has(i)) return `${base} border-viz-flash bg-viz-flash/10 text-viz-flash`;
    if (i === 0) return `${base} border-viz-flash bg-viz-flash/10 text-viz-flash`;
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
        <div className="text-xs text-viz-ink/60">{name}: stack</div>
        <div className="flex flex-col gap-0.5">
          {items.map((item, i) => (
            <div key={i} className={itemClass(i)} style={flashStyle(changed.has(i))} {...itemAttrs(i)}>
              {i === 0 && <span className="text-viz-flash mr-1">top →</span>}
              {renderCellValue(item)}
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
        {name}: stack ({items.length})
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
            const item = items[idx];
            return (
              <div
                key={virtualItem.key}
                className={itemClass(idx)}
                {...itemAttrs(idx)}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: `${virtualItem.size}px`,
                  transform: `translateY(${virtualItem.start}px)`,
                  ...flashStyle(changed.has(idx)),
                }}
              >
                {idx === 0 && (
                  <span className="text-viz-flash mr-1">top →</span>
                )}
                {renderCellValue(item)}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
