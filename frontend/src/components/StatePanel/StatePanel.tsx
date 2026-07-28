/**
 * components/StatePanel/StatePanel.tsx — Variable state at the current step.
 *
 * Shows variables from the current trace event.
 * Highlights values that changed since the previous step.
 * Pure display component — reads from traceStore only.
 */

import { useTraceStore } from "../../store/traceStore";
import { CallStackView } from "./CallStackView";
import { VariableRow } from "./VariableRow";

export function StatePanel() {
  const { trace, currentStep, currentEvent } = useTraceStore();

  if (!currentEvent) {
    return (
      <div className="p-4 text-zinc-500 text-sm">
        Run a program to see variable state.
      </div>
    );
  }

  // Get vars from current event
  const vars: Record<string, unknown> =
    currentEvent.type === "state"
      ? currentEvent.vars
      : currentEvent.type === "enter"
      ? currentEvent.params
      : {};

  // Get previous step's vars for diff highlighting
  const prevEvent = currentStep > 0 ? trace[currentStep - 1] : null;
  const prevVars: Record<string, unknown> =
    prevEvent?.type === "state"
      ? prevEvent.vars
      : prevEvent?.type === "enter"
      ? prevEvent.params
      : {};

  const entries = Object.entries(vars);

  // ── Highlight index mapping ─────────────────────────────────────────
  // For binary search / divide-and-conquer patterns: if the current state
  // has scalar index variables (mid, lo, hi), find the corresponding array
  // and compute which index to highlight.
  const highlightMap = buildHighlightMap(vars);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 border-b border-zinc-800 flex items-center justify-between">
        <span className="text-xs font-medium text-zinc-400 uppercase tracking-wide">
          Variables
        </span>
        <span className="text-xs text-zinc-600">
          {currentEvent.func}() · line {currentEvent.line}
        </span>
      </div>

      {/* Call stack badge */}
      <div className="px-3 py-1.5 border-b border-zinc-800">
        <div className="flex items-center gap-1">
          <span className="text-xs text-zinc-500">depth</span>
          <span className="text-xs font-mono text-amber-400">{currentEvent.depth}</span>
          <span className="text-xs text-zinc-500 ml-2">in</span>
          <span className="text-xs font-mono text-zinc-300">{currentEvent.func}()</span>
        </div>
      </div>

      {/* Variable list */}
      <div className="flex-1 overflow-y-auto">
        {entries.length === 0 ? (
          <div className="px-3 py-2 text-xs text-zinc-600">No variables in scope</div>
        ) : (
          entries.map(([name, value]) => (
            <VariableRow
              key={name}
              name={name}
              value={value}
              changed={
                name in prevVars &&
                JSON.stringify(prevVars[name]) !== JSON.stringify(value)
              }
              highlightIndex={highlightMap[name]}
            />
          ))
        )}
      </div>

      {/* Event type badge */}
      <div className="px-3 py-2 border-t border-zinc-800">
        <EventBadge event={currentEvent} />
      </div>

      {/* Call stack */}
      <CallStackView />
    </div>
  );
}

/**
 * For state events: if scalar index variables (mid, lo, hi) exist alongside
 * array variables, map each array variable to the primary highlight index.
 * Order of preference: mid → lo → hi.
 */
function buildHighlightMap(vars: Record<string, unknown>): Record<string, number> {
  const map: Record<string, number> = {};

  // Determine the primary index to highlight
  let index: number | undefined;
  if (typeof vars.mid === "number") index = vars.mid as number;
  else if (typeof vars.lo === "number") index = vars.lo as number;
  else if (typeof vars.hi === "number") index = vars.hi as number;
  if (index === undefined) return map;

  // Apply to every 1D array variable in scope (not 2D arrays)
  for (const [name, value] of Object.entries(vars)) {
    if (Array.isArray(value) && !(value.length > 0 && Array.isArray(value[0]))) {
      map[name] = index;
    }
  }
  return map;
}

function EventBadge({ event }: { event: NonNullable<ReturnType<typeof useTraceStore.getState>["currentEvent"]> }) {
  const colors: Record<string, string> = {
    enter:  "bg-blue-500/20 text-blue-400",
    exit:   "bg-purple-500/20 text-purple-400",
    state:  "bg-zinc-700 text-zinc-400",
    branch: "bg-amber-500/20 text-amber-400",
    iter:   "bg-emerald-500/20 text-emerald-400",
  };
  const labels: Record<string, string> = {
    enter:  "func enter",
    exit:   "func exit",
    state:  "state",
    branch: event.type === "branch" ? `branch: ${event.taken ? "true" : "false"}` : "branch",
    iter:   event.type === "iter" ? `loop iter ${event.iteration}` : "iter",
  };

  return (
    <span className={`text-xs px-2 py-0.5 rounded font-mono ${colors[event.type] ?? "bg-zinc-700 text-zinc-400"}`}>
      {labels[event.type] ?? event.type}
    </span>
  );
}
