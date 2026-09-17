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

import { useMemo, useState } from "react";
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
import { HeapPanel } from "../ContainerVisuals/HeapPanel";
import type { HeapDiffShape } from "../ContainerVisuals/HeapPanel";
import { buildFramesWithVars } from "./frameVars";

/**
 * $id/$ref identity tags inside a frame var value (backend T11b heap
 * identity). Scans the JSON form so nested refs count without recursion.
 */
function collectIdentityIds(value: unknown): string[] {
  const out = new Set<string>();
  try {
    const s = JSON.stringify(value) ?? "";
    const re = /"\$(?:id|ref)"\s*:\s*(\d+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s)) !== null) out.add(m[1]);
  } catch {
    /* unstringifiable — no identity */
  }
  return [...out];
}

export function StatePanel() {
  const { trace, currentStep, currentEvent, lastLiveByFrame, callStack } = useTraceStore();
  const [globalsOpen, setGlobalsOpen] = useState(true);

  // T9 phase-2: per-frame var tables (frontend mirror of stack_to_render).
  // Shown only when the stack holds 2+ frames; single-frame traces keep the
  // legacy flat list unchanged (flat fallback path, never removed).
  // All hooks stay above the !currentEvent early return (React #310).
  const frames = useMemo(
    () => buildFramesWithVars(trace, currentStep, callStack),
    [trace, currentStep, callStack],
  );
  // Deepest frame first for display (current frame on top).
  const framesDisplay = useMemo(() => [...frames].reverse(), [frames]);
  const showFrameTables = frames.length >= 2;

  if (!currentEvent) {
    return (
      <div className="p-4 text-viz-ink/60 text-sm">
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

  // v2 additive-only: short one-liner for this step; absent on v1 traces
  const stepDesc =
    typeof currentEvent.step_desc === "string" &&
    currentEvent.step_desc.length > 0
      ? currentEvent.step_desc
      : null;

  // v2 additive-only: globals captured at this step; absent/null on v1 traces
  const globalEntries =
    currentEvent.type === "state" &&
    currentEvent.globals != null &&
    typeof currentEvent.globals === "object"
      ? Object.entries(currentEvent.globals)
      : [];

  // T12 HeapPanel: per-step heap table + per-$id diff. Tolerates the
  // non-streaming alias keys ("h"/"hd") — the NDJSON stream carries the
  // python names, which api.ts passes through by reference. Heap-less
  // traces keep both null so the panel stays hidden (legacy fallback).
  const rawEvent = currentEvent as unknown as Record<string, unknown>;
  const heap =
    currentEvent.type === "state"
      ? ((currentEvent.heap ?? rawEvent.h) as Record<string, unknown> | null | undefined)
      : null;
  const heapDiff =
    currentEvent.type === "state"
      ? ((currentEvent.heap_diff ?? rawEvent.hd) as HeapDiffShape | null | undefined)
      : null;

  // ── Highlight index mapping ─────────────────────────────────────────
  const highlightMap = highlight.map;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 border-b border-viz-line flex items-center justify-between">
        <span className="text-xs font-medium text-viz-ink/60 uppercase tracking-wide">
          Variables
        </span>
        <span className="text-xs text-viz-ink/60">
          {currentEvent.func}() · line {currentEvent.line}
        </span>
      </div>

      {/* Call stack badge */}
      <div className="px-3 py-1.5 border-b border-viz-line">
        <div className="flex items-center gap-1">
          <span className="text-xs text-viz-ink/60">depth</span>
          <span className="text-xs font-mono text-amber-400">{currentEvent.depth}</span>
          <span className="text-xs text-viz-ink/60 ml-2">in</span>
          <span className="text-xs font-mono text-viz-ink">{currentEvent.func}()</span>
        </div>
        {display.carried && display.staleStep !== null && (
          <div className="text-[10px] font-mono text-viz-ink/40 mt-0.5">
            showing last state · step {display.staleStep + 1}
          </div>
        )}
        {highlight.caption && (
          <div className="text-[10px] font-mono text-viz-ink/40 mt-0.5">
            {highlight.caption}
          </div>
        )}
      </div>

      {/* Step description header (v2 only — absent on v1 traces) */}
      {stepDesc != null && (
        <div className="px-3 py-1.5 border-b border-viz-line">
          <span data-testid="step-desc-header" className="text-xs font-mono text-viz-ink">
            {stepDesc}
          </span>
        </div>
      )}

      {/* Globals section (v2 only — collapsible, above frame vars) */}
      {globalEntries.length > 0 && (
        <div data-testid="globals-section" className="border-b border-viz-line">
          <button
            onClick={() => setGlobalsOpen((v) => !v)}
            className="w-full flex items-center gap-1 px-3 py-1.5 text-xs text-viz-ink/60 hover:text-viz-ink transition-colors"
            aria-expanded={globalsOpen}
          >
            <span className="font-mono">{globalsOpen ? "▾" : "▸"}</span>
            <span className="font-medium uppercase tracking-wide">Globals</span>
            <span className="font-mono text-viz-ink/60">({globalEntries.length})</span>
          </button>
          {globalsOpen && (
            <div data-testid="frame-table" data-frame="globals">
              {globalEntries.map(([name, value]) => (
                <VariableRow
                  key={`global:${name}`}
                  name={name}
                  value={value}
                  status="normal"
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Per-frame var tables (nested stacks only; flat list below is untouched) */}
      {showFrameTables && (
        <div className="border-b border-viz-line">
          {framesDisplay.map((frame, frameIdx) => {
            const frameEntries = Object.entries(frame.vars);
            const isCurrentFrame =
              frame.func === currentEvent.func && frame.depth === currentEvent.depth;
            return (
              <div
                key={`${frame.func}@${frame.depth}`}
                data-testid="frame-table"
                data-frame={`${frame.func}@${frame.depth}`}
                className={isCurrentFrame ? undefined : "opacity-60"}
              >
                <div className="px-3 py-1 flex items-center gap-1 min-w-0">
                  <span className="text-[10px] font-medium text-viz-ink/60 uppercase tracking-wide shrink-0">
                    Frame
                  </span>
                  <span className="text-[11px] font-mono text-amber-400 truncate">
                    {frame.func}()
                  </span>
                  {isCurrentFrame && (
                    <span className="text-[10px] text-viz-ink/60 shrink-0">
                      · current
                    </span>
                  )}
                  <span className="text-[10px] text-viz-ink/60 ml-auto shrink-0">
                    depth {frame.depth}
                  </span>
                </div>
                {frameEntries.length === 0 ? (
                  <div className="px-3 py-1 text-xs text-viz-ink/60">No vars in frame</div>
                ) : (
                  frameEntries.map(([name, value]) => {
                    const ids = collectIdentityIds(value);
                    const owner =
                      ids.length > 0
                        ? framesDisplay
                            .slice(0, frameIdx)
                            .find((f) =>
                              Object.values(f.vars).some((v) =>
                                collectIdentityIds(v).some((id) => ids.includes(id)),
                              ),
                            )
                        : undefined;
                    if (owner) {
                      return (
                        <div
                          key={`${frame.func}:${name}`}
                          data-testid="same-object-ref"
                          className="px-3 py-1 text-[11px] font-mono text-viz-ink/50 truncate"
                        >
                          {name}: same object as {owner.func}()
                        </div>
                      );
                    }
                    return (
                      <VariableRow
                        key={`${frame.func}:${name}`}
                        name={name}
                        value={value}
                        status="normal"
                      />
                    );
                  })
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Variable list — flat current-frame rows. No frame header here: with
          2+ frames the per-frame tables above already label the current
          frame, and a second header renders it twice (bug-A). */}
      <div className="flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <div className="px-3 py-2 text-xs text-viz-ink/60">No variables in scope</div>
        ) : (
          rows.map((row) => (
            <VariableRow
              key={row.name}
              name={row.name}
              value={row.value}
              status={row.status}
              highlightIndex={highlightMap[row.name]}
              heap={heap}
              heapDiff={heapDiff}
              prevValue={prevLive?.vars[row.name]}
            />
          ))
        )}
      </div>

      {/* T12 HeapPanel (R6 lazy/opt-in: collapsed by default; hidden when heap-less) */}
      <HeapPanel heap={heap} heapDiff={heapDiff} vars={display.vars} />

      {/* Event type badge */}
      <div className="px-3 py-2 border-t border-viz-line">
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
    state:  "bg-viz-panel text-viz-ink/60",
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
    <span className={`text-xs px-2 py-0.5 rounded font-mono ${colors[event.type] ?? "bg-viz-panel text-viz-ink/60"}`}>
      {labels[event.type] ?? event.type}
    </span>
  );
}
