/**
 * components/StatePanel/StatePanel.tsx — Variable state at the current step.
 *
 * Shows variables from the current trace event.
 * Highlights values that changed since the previous step.
 * Pure display component — reads from traceStore only.
 */

import { useMemo, useState } from "react";
import { useTraceStore } from "../../store/traceStore";
import { CallStackView } from "./CallStackView";
import { VariableRow } from "./VariableRow";
import { HeapPanel } from "../ContainerVisuals/HeapPanel";
import type { HeapDiffShape } from "../ContainerVisuals/HeapPanel";
import { buildFramesWithVars } from "./frameVars";

export function StatePanel() {
  const { trace, currentStep, currentEvent, callStack } = useTraceStore();
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

      {/* Step description header (v2 only — absent on v1 traces) */}
      {stepDesc != null && (
        <div className="px-3 py-1.5 border-b border-zinc-800">
          <span data-testid="step-desc-header" className="text-xs font-mono text-zinc-300">
            {stepDesc}
          </span>
        </div>
      )}

      {/* Globals section (v2 only — collapsible, above frame vars) */}
      {globalEntries.length > 0 && (
        <div data-testid="globals-section" className="border-b border-zinc-800">
          <button
            onClick={() => setGlobalsOpen((v) => !v)}
            className="w-full flex items-center gap-1 px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            aria-expanded={globalsOpen}
          >
            <span className="font-mono">{globalsOpen ? "▾" : "▸"}</span>
            <span className="font-medium uppercase tracking-wide">Globals</span>
            <span className="font-mono text-zinc-600">({globalEntries.length})</span>
          </button>
          {globalsOpen && (
            <div data-testid="frame-table" data-frame="globals">
              {globalEntries.map(([name, value]) => (
                <VariableRow
                  key={`global:${name}`}
                  name={name}
                  value={value}
                  changed={false}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Per-frame var tables (nested stacks only; flat list below is untouched) */}
      {showFrameTables && (
        <div className="border-b border-zinc-800">
          {framesDisplay.map((frame) => {
            const frameEntries = Object.entries(frame.vars);
            return (
              <div
                key={`${frame.func}@${frame.depth}`}
                data-testid="frame-table"
                data-frame={`${frame.func}@${frame.depth}`}
              >
                <div className="px-3 py-1 flex items-center gap-1">
                  <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wide">
                    Frame
                  </span>
                  <span className="text-[11px] font-mono text-amber-400">
                    {frame.func}()
                  </span>
                  <span className="text-[10px] text-zinc-600 ml-auto">
                    depth {frame.depth}
                  </span>
                </div>
                {frameEntries.length === 0 ? (
                  <div className="px-3 py-1 text-xs text-zinc-600">No vars in frame</div>
                ) : (
                  frameEntries.map(([name, value]) => (
                    <VariableRow
                      key={`${frame.func}:${name}`}
                      name={name}
                      value={value}
                      changed={false}
                    />
                  ))
                )}
              </div>
            );
          })}
        </div>
      )}

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
              heap={heap}
              heapDiff={heapDiff}
              prevValue={name in prevVars ? prevVars[name] : undefined}
            />
          ))
        )}
      </div>

      {/* T12 HeapPanel (R6 lazy/opt-in: collapsed by default; hidden when heap-less) */}
      <HeapPanel heap={heap} heapDiff={heapDiff} vars={vars} />

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
