/**
 * components/StatePanel/VariableRow.tsx — One variable with its value.
 *
 * Highlights changed values in cyan.
 * Dispatches to the appropriate container visual based on value shape.
 * Falls back to plain text for primitives.
 */

import { useContainerType } from "../../hooks/useContainerType";
import { VISUAL_REGISTRY } from "../ContainerVisuals/registry";
import { ErrorBoundary } from "../ContainerVisuals/ErrorBoundary";
import { renderCellValue } from "../../utils/format";


interface Props {
  name: string;
  value: unknown;
  changed: boolean;
  /** Index to highlight in array-type visuals (e.g. mid in binary search). */
  highlightIndex?: number;
}

export function VariableRow({ name, value, changed, highlightIndex }: Props) {
  const containerKind = useContainerType(value);

  return (
    <div
      className={`flex flex-col gap-1 px-3 py-1.5 border-b border-zinc-800/50 ${
        changed ? "bg-cyan-500/15" : ""
      }`}
    >
      {/* Name + changed badge */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono text-zinc-400 min-w-[80px] shrink-0">
          {name}
        </span>
        {changed && (
          <span className="text-xs text-cyan-400 shrink-0 ml-auto">changed</span>
        )}
      </div>

      {/* Value visual */}
      <div className={`text-xs font-mono ${changed ? "text-cyan-400" : "text-zinc-200"}`}>
        <ValueVisual name={name} value={value} kind={containerKind} highlightIndex={highlightIndex} />
      </div>
    </div>
  );
}

interface ValueVisualProps {
  name: string;
  value: unknown;
  kind: ReturnType<typeof useContainerType>;
  highlightIndex?: number;
}

function ValueVisual({ name, value, kind, highlightIndex }: ValueVisualProps) {
  const Component = VISUAL_REGISTRY[kind];
  if (!Component) return <span className="break-all">{renderCellValue(value)}</span>;
  return (
    <ErrorBoundary>
      <Component value={value} name={name} highlightIndex={highlightIndex} />
    </ErrorBoundary>
  );
}
