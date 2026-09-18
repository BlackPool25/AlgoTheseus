/**
 * components/ContainerVisuals/SetVisual.tsx — Set/multiset visualization.
 *
 * Renders a set as member chips. Accepts a plain array or the backend
 * `{ _type: "set", values: [...] }` envelope (`items` also accepted).
 * Insert/remove flash comes
 * from the shared flash.ts primitive (todo 25).
 */

import { renderCellValue } from "../../utils/format";
import { asItems } from "../../utils/setItems";
import { flashRowStyle } from "./flash";

interface Props {
  value: unknown;
  label?: string;
  /** Members added this step — flash via the shared primitive. */
  changedMembers?: unknown[];
}

export function SetVisual({ value, label = "set", changedMembers = [] }: Props) {
  const items = asItems(value);
  if (!items) {
    return (
      <div className="flex flex-col gap-1">
        <span data-testid="primitive-fallback" className="text-[10px] text-viz-ink/60 italic">
          {renderCellValue(value)}
        </span>
      </div>
    );
  }
  const changed = new Set(changedMembers.map((v) => JSON.stringify(v)));
  const display = items.slice(0, 12);
  const overflow = items.length - display.length;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-0.5">
        {display.map((item, i) => {
          const flashed = changed.has(JSON.stringify(item));
          return (
            <div
              key={i}
              data-testid="set-chip"
              data-flash={flashed ? "true" : "false"}
              className={`flex items-center justify-center min-w-[28px] h-6 px-1.5 border text-[10px] font-mono rounded-sm ${flashed ? "border-viz-flash bg-viz-flash/15 text-viz-flash" : "border-viz-line bg-viz-panel text-viz-ink"}`}
              style={flashRowStyle(flashed)}
            >
              {renderCellValue(item)}
            </div>
          );
        })}
        {overflow > 0 && (
          <div className="flex items-center justify-center h-6 px-1.5 text-[10px] text-viz-ink/60">
            +{overflow}
          </div>
        )}
        {items.length === 0 && (
          <span className="text-[10px] text-viz-ink/60 italic">∅ empty</span>
        )}
      </div>
      <span className="text-[9px] text-viz-ink/60">{label} · {items.length} items</span>
    </div>
  );
}
