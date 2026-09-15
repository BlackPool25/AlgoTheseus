/**
 * components/StatePanel/StatePanel.tsx — Variable state at the current step.
 *
 * Loop-control steps (`iter` / `branch`) and `exit` carry no vars by schema,
 * so they forward-fill the last live snapshot of the current frame instead
 * of rendering blank. Carried rows render dimmed with a staleness caption;
 * diffs are always computed live-vs-last-LIVE so held values flash once on
 * the mutating step and never on carried steps.
 * Pure display component — reads from traceStore only.
 */

import { useTraceStore } from "../../store/traceStore";
import { CallStackView } from "./CallStackView";
import { VariableRow } from "./VariableRow";
import {
  buildHighlightMap,
  computeRowStates,
  findLastLiveSnapshot,
  frameKey,
  liveVarsOf,
  resolveDisplayVars,
} from "../../utils/scopeDisplay";

export function StatePanel() {
  const { trace, currentStep, currentEvent, lastLiveByFrame } = useTraceStore();

  if (!currentEvent) {
    return (
      <div className="p-4 text-zinc-500 text-sm">
        Run a program to see variable state.
      </div>
    );
  }

  const key = frameKey(currentEvent.func, currentEvent.depth);
  const isLiveStep = liveVarsOf(currentEvent) !== null;

  // Carried display source: O(1) store cache, scan-back fallback on jumps.
  const cached = lastLiveByFrame[key] ?? null;
  const lastLive =
    cached !== null && cached.step <= currentStep
      ? cached
      : findLastLiveSnapshot(
          trace,
          currentStep,
          currentEvent.func,
          currentEvent.depth,
        );
  const display = resolveDisplayVars(
    currentEvent,
    isLiveStep ? null : lastLive,
  );

  // Diff base: last LIVE snapshot strictly before this step (carried steps
  // are excluded from both sides, so holds across blank iters never flash).
  const prevLive = isLiveStep
    ? findLastLiveSnapshot(
        trace,
        currentStep - 1,
        currentEvent.func,
        currentEvent.depth,
      )
    : null;
  const rows = computeRowStates(
    display,
    prevLive?.vars ?? null,
    isLiveStep,
  );

  const highlight = buildHighlightMap(display.vars);

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
        {display.carried && display.staleStep !== null && (
          <div className="text-[11px] text-zinc-600 mt-0.5">
            showing last state · step {display.staleStep}
          </div>
        )}
        {highlight.caption && (
          <div className="text-[11px] font-mono text-zinc-500 mt-0.5">
            {highlight.caption}
          </div>
        )}
      </div>

      {/* Variable list */}
      <div className="flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <div className="px-3 py-2 text-xs text-zinc-600">No variables in scope</div>
        ) : (
          rows.map((row) => (
            <VariableRow
              key={row.name}
              name={row.name}
              value={row.value}
              status={row.status}
              highlightIndex={highlight.map[row.name]}
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

function EventBadge({ event }: { event: NonNullable<ReturnType<typeof useTraceStore.getState>["currentEvent"]> }) {
  const colors: Record<string, string> = {
    enter:  "bg-blue-500/20 text-blue-400",
    exit:   "bg-purple-500/20 text-purple-400",
    state:  "bg-zinc-700 text-zinc-400",
    branch: "bg-orange-500/20 text-orange-400",
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
