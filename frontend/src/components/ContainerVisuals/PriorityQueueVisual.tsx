/**
 * components/ContainerVisuals/PriorityQueueVisual.tsx — Priority queue visualization.
 *
 * Shows the heap as a pyramid: top element highlighted, rest in descending rows.
 * Backend serializes priority_queue as: { top: T, items: T[] }
 */

import { renderCellValue } from "../../utils/format";

interface PQData {
  top: unknown;
  items: unknown[];
}

interface Props {
  value: PQData;
}

export function PriorityQueueVisual({ value }: Props) {
  const items = value.items ?? [];
  const top = value.top;

  // Show at most 7 items in a compact heap view
  const display = items.slice(0, 7);

  return (
    <div className="flex flex-col gap-1">
      {/* Top element */}
      {top !== null && top !== undefined && (
        <div className="flex justify-center">
          <div className="flex items-center justify-center min-w-[40px] h-7 px-2 border-2 border-orange-500 bg-orange-500/15 text-orange-300 text-[11px] font-mono font-bold rounded">
            {renderCellValue(top)}
          </div>
        </div>
      )}

      {/* Remaining items */}
      {display.length > 1 && (
        <div className="flex flex-wrap justify-center gap-0.5">
          {display.slice(1).map((item, i) => (
            <div
              key={i}
              className="flex items-center justify-center min-w-[28px] h-6 px-1 border border-orange-800 bg-orange-900/20 text-orange-400 text-[10px] font-mono rounded-sm"
            >
              {renderCellValue(item)}
            </div>
          ))}
        </div>
      )}

      {items.length === 0 && (
        <span className="text-[10px] text-zinc-600 italic">empty</span>
      )}

      <span className="text-[9px] text-zinc-600">priority_queue · {items.length} items</span>
    </div>
  );
}
