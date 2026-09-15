/**
 * components/StatePanel/VariableRow.tsx — One variable with its value.
 *
 * Row treatments (R6): changed → amber flash, added → emerald "new",
 * removed → dimmed ghost with line-through, carried (forward-filled stale
 * snapshot) → dimmed with no badge. Dispatches to the appropriate
 * container visual based on value shape. Falls back to plain text.
 */

import { useContainerType } from "../../hooks/useContainerType";
import { VISUAL_REGISTRY } from "../ContainerVisuals/registry";
import { ErrorBoundary } from "../ContainerVisuals/ErrorBoundary";
import { renderCellValue } from "../../utils/format";
import type { RowStatus } from "../../utils/scopeDisplay";


interface Props {
  name: string;
  value: unknown;
  status: RowStatus;
  /** Index to highlight in array-type visuals (e.g. i in a for loop). */
  highlightIndex?: number;
}

const ROW_STYLE: Record<RowStatus, string> = {
  normal: "",
  changed: "bg-amber-500/15",
  added: "bg-emerald-500/15",
  removed: "opacity-70",
  carried: "",
};

const VALUE_STYLE: Record<RowStatus, string> = {
  normal: "text-zinc-200",
  changed: "text-amber-400",
  added: "text-emerald-400",
  removed: "text-zinc-600 line-through",
  carried: "text-zinc-500",
};

const BADGE: Record<RowStatus, { label: string; className: string } | null> = {
  normal: null,
  changed: { label: "changed", className: "text-amber-400" },
  added: { label: "new", className: "text-emerald-400" },
  removed: { label: "removed", className: "text-zinc-600" },
  carried: null,
};

export function VariableRow({ name, value, status, highlightIndex }: Props) {
  const containerKind = useContainerType(value);
  const badge = BADGE[status];

  return (
    <div
      className={`flex flex-col gap-1 px-3 py-1.5 border-b border-zinc-800/50 ${ROW_STYLE[status]}`}
    >
      {/* Name + status badge */}
      <div className="flex items-center gap-2">
        <span
          className={`text-xs font-mono min-w-[80px] shrink-0 ${
            status === "carried" ? "text-zinc-500" : "text-zinc-400"
          }`}
        >
          {name}
        </span>
        {badge && (
          <span className={`text-xs shrink-0 ml-auto ${badge.className}`}>{badge.label}</span>
        )}
      </div>

      {/* Value visual */}
      <div className={`text-xs font-mono ${VALUE_STYLE[status]}`}>
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
