/**
 * components/ContainerVisuals/SetVisual.tsx — Set/multiset visualization.
 *
 * Renders a set as sorted boxes with a distinct teal color scheme.
 * Backend serializes set as a plain array (already sorted for std::set).
 */

import { renderCellValue } from "../../utils/format";

interface Props {
  value: unknown[];
  label?: string;
}

export function SetVisual({ value, label = "set" }: Props) {
  const items = value ?? [];
  const display = items.slice(0, 12);
  const overflow = items.length - display.length;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-0.5">
        {display.map((item, i) => (
          <div
            key={i}
            className="flex items-center justify-center min-w-[28px] h-6 px-1.5 border border-teal-700 bg-teal-900/30 text-teal-300 text-[10px] font-mono rounded-sm"
          >
            {renderCellValue(item)}
          </div>
        ))}
        {overflow > 0 && (
          <div className="flex items-center justify-center h-6 px-1.5 text-[10px] text-zinc-500">
            +{overflow}
          </div>
        )}
        {items.length === 0 && (
          <span className="text-[10px] text-zinc-600 italic">∅ empty</span>
        )}
      </div>
      <span className="text-[9px] text-zinc-600">{label} · {items.length} items</span>
    </div>
  );
}
