/**
 * store/traceStore.ts — Zustand store for trace navigation.
 *
 * Owns: the flat trace array, current step index, current call stack,
 * compressed-step grouping, and navigation actions.  The call stack is
 * maintained *incrementally* during step-by-step navigation (O(1) per
 * step) instead of being rebuilt from scratch on every render.
 *
 * Compression groups consecutive steps whose *display* identity (live
 * vars for `state`/`enter`, forward-filled snapshot for carried
 * `iter`/`branch`/`exit`) is identical into a single display group.
 * Groups can be collapsed (prev/next land on the group boundary, never
 * skip over it) or expanded (individual steps are shown).
 */

import { create } from "zustand";
import { assertNever, type TraceEvent } from "../types/trace";
import {
  findLastLiveSnapshot,
  frameKey,
  liveVarsOf,
} from "../utils/scopeDisplay";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CompressedStep {
  /** Index of the first step in the group (inclusive). */
  startStep: number;
  /** Index of the last step in the group (inclusive). */
  endStep: number;
  /** Number of consecutive identical events that this group represents. */
  count: number;
}

interface StackFrame {
  func: string;
  depth: number;
  line: number;
}

/** Last live (`state` / `enter`) snapshot per `func@depth` frame. */
export interface LiveSnapshot {
  vars: Record<string, unknown>;
  step: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Apply one trace event to `stack` (forward) or undo it (backward). */
function applyEvent(
  stack: StackFrame[],
  event: TraceEvent,
  forward: boolean,
): void {
  if (forward) {
    if (event.type === "enter") {
      stack.push({ func: event.func, depth: event.depth, line: event.line });
    } else if (event.type === "exit") {
      for (let j = stack.length - 1; j >= 0; j--) {
        if (stack[j].func === event.func) {
          stack.splice(j, 1);
          break;
        }
      }
    }
  } else {
    // backward – undo what the forward pass did
    if (event.type === "enter") {
      stack.pop();
    } else if (event.type === "exit") {
      stack.push({ func: event.func, depth: event.depth, line: event.line });
    }
  }
}

/** Build the call stack from scratch by scanning trace[0 … upToStep]. */
function rebuildCallStack(
  trace: TraceEvent[],
  upToStep: number,
): StackFrame[] {
  const stack: StackFrame[] = [];
  for (let i = 0; i <= upToStep && i < trace.length; i++) {
    applyEvent(stack, trace[i], true);
  }
  return stack;
}

/**
 * Rebuild the per-frame last-live snapshot cache by scanning
 * trace[0 … upToStep]. Used on load / random jump / stream completion.
 */
function buildLiveCache(
  trace: TraceEvent[],
  upToStep: number,
): Record<string, LiveSnapshot> {
  const cache: Record<string, LiveSnapshot> = {};
  const end = Math.min(upToStep, trace.length - 1);
  for (let i = 0; i <= end; i++) {
    const live = liveVarsOf(trace[i]);
    if (live !== null) {
      cache[frameKey(trace[i].func, trace[i].depth)] = { vars: live, step: i };
    }
  }
  return cache;
}

/** Compression identity for a STATE event: vars plus stdout/heap when present.
Only STATE events are ever compressed. Absent stdout/heap keep the key
identical to the vars-only form, so v1 traces group exactly as before. A
present stdout or heap value breaks the group — vars-equality alone would
merge steps whose output or heap differ and hide growing stdout. */
function compressionKey(event: TraceEvent): string | null {
  if (event.type !== "state") return null;
  let key = JSON.stringify(event.vars);
  if (typeof event.stdout === "string") key += "\nstdout:" + event.stdout;
  if (event.heap != null) key += "\nheap:" + JSON.stringify(event.heap);
  return key;
}

/**
 * Display (filled) identity for one step — the single grouping scheme used
 * by rebuildCompression (extended, not forked, from compressionKey).
 *
 * Live steps (`state` / `enter`) key on their own payload (vars, plus
 * stdout/heap when present — a present stdout or heap value breaks the
 * group, so growing output never hides). Carried steps (`iter` / `branch` /
 * `exit`) are first-class groupable citizens per follow-up spec §(b)+§(e):
 * they key on the forward-filled snapshot (`filledVars`, the last live
 * payload strictly before this step in the same `func`+`depth` frame —
 * same strictly-before convention as scopeDisplay), so a run of
 * carried-identical snapshots groups into one "N identical steps" bundle.
 *
 * Two guards keep grouping honest:
 * - Control-significant fields participate: `branch` adds condition+taken
 *   (distinct outcomes never merge), `exit` adds return_val (distinct
 *   returns never merge). `iter`'s counter is positional — the group span
 *   k–m already conveys it — so alternating state/iter runs with identical
 *   display vars collapse into one group.
 * - The key is prefixed with the frame (`func@depth`), so groups never span
 *   frames and a live step whose payload differs from the running key
 *   breaks the run: grouping never merges across a live mutation.
 * - Carried steps with no live predecessor (`filledVars === null`) render
 *   blank and stay ungrouped (null key) — never merged with anything.
 */
function displayCompressionKey(
  event: TraceEvent,
  filledVars: Record<string, unknown> | null,
): string | null {
  const frame = frameKey(event.func, event.depth);
  switch (event.type) {
    case "state": {
      const live = compressionKey(event);
      return live === null ? null : frame + "\n" + live;
    }
    case "enter":
      return frame + "\n" + JSON.stringify(event.params);
    case "iter":
      return filledVars === null ? null : frame + "\n" + JSON.stringify(filledVars);
    case "branch":
      return filledVars === null
        ? null
        : frame +
            "\n" +
            JSON.stringify(filledVars) +
            "|branch:" +
            event.condition +
            ":" +
            (event.taken ? "1" : "0");
    case "exit":
      return filledVars === null
        ? null
        : frame +
            "\n" +
            JSON.stringify(filledVars) +
            "|return:" +
            JSON.stringify(event.return_val);
    default:
      return assertNever(event);
  }
}

/**
 * Scan the trace and produce a list of compressed-step groups.
 *
 * Two compression strategies:
 * 1. **Backend metadata** – if an event carries `_group_count` (>1) the
 *    backend already collapsed it; we use the metadata directly (checked
 *    first in both the outer and inner scan, so a metadata event is never
 *    swallowed into a frontend-detected run).
 * 2. **Frontend detection** – consecutive steps whose *display* identity
 *    (displayCompressionKey: live payload for `state`/`enter`,
 *    forward-filled snapshot for carried `iter`/`branch`/`exit`) serialises
 *    to the same string are grouped. Only runs of length > 1 become groups;
 *    every other step stays a singleton and remains individually reachable.
 *
 * Forward-fill here is O(1) amortised (running last-live map per frame, no
 * scan-back), so rebuild stays cheap on 10–100k-step traces (R7 p95 budget).
 */
function rebuildCompression(trace: TraceEvent[]): CompressedStep[] {
  const groups: CompressedStep[] = [];

  // Pass 1 — per-step display keys with running forward-fill.
  const keys: Array<string | null> = [];
  const lastLive = new Map<string, Record<string, unknown>>();
  for (const event of trace) {
    const frame = frameKey(event.func, event.depth);
    keys.push(displayCompressionKey(event, lastLive.get(frame) ?? null));
    const live = liveVarsOf(event);
    if (live !== null) lastLive.set(frame, live);
  }

  // Pass 2 — group consecutive steps with equal non-null keys.
  let i = 0;

  while (i < trace.length) {
    const event = trace[i];

    // 1. Backend-provided compression metadata
    const groupCount = (event as unknown as Record<string, unknown>).group_count;
    if (typeof groupCount === "number" && groupCount > 1) {
      const groupStart = ((event as unknown as Record<string, unknown>).group_start ??
        i) as number;
      const groupEnd = ((event as unknown as Record<string, unknown>).group_end ??
        i) as number;
      groups.push({ startStep: groupStart, endStep: groupEnd, count: groupCount });
      i++;
      continue;
    }

    // 2. Frontend-side detection — run-length over display-identity keys.
    // A null key (blank carried step with no live predecessor) never groups.
    const key = keys[i];
    if (key === null) {
      i++;
      continue;
    }

    let j = i + 1;
    while (j < trace.length && keys[j] === key) {
      // Backend metadata keeps priority: never swallow a metadata event
      // into a frontend-detected run.
      const upcoming = (trace[j] as unknown as Record<string, unknown>).group_count;
      if (typeof upcoming === "number" && upcoming > 1) break;
      j++;
    }

    const count = j - i;
    if (count > 1) {
      groups.push({ startStep: i, endStep: j - 1, count });
    }

    i = j;
  }

  return groups;
}

/** Find the compressed group that contains `step`, or null. */
function groupContaining(
  groups: CompressedStep[],
  step: number,
  expanded: number[],
): CompressedStep | null {
  // Ignore groups marked as expanded
  for (const g of groups) {
    if (step >= g.startStep && step <= g.endStep && !expanded.includes(g.startStep)) {
      return g;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface TraceStore {
  trace: TraceEvent[];
  totalSteps: number;
  currentStep: number;
  currentEvent: TraceEvent | null;
  /** Current call stack (chronological order — deepest call last). */
  callStack: StackFrame[];
  /** Groups of consecutive identical STATE events for display compression. */
  compressedSteps: CompressedStep[];
  /** `startStep` values of compressed groups the user has expanded. */
  expandedGroups: number[];
  /** True while an NDJSON streaming response is being consumed. */
  isStreaming: boolean;
  /** Last live snapshot per `func@depth` frame (forward-fill source). */
  lastLiveByFrame: Record<string, LiveSnapshot>;

  /** Load a new trace (resets step to 0 and builds the initial stack). */
  loadTrace: (trace: TraceEvent[]) => void;
  /** Jump to a specific step (always works, no group skipping). */
  setStep: (n: number) => void;
  /** T14 boundary-landing contract (chosen alternative: enter-at-near-edge,
   *  second press exits — symmetric for both directions):
   *  `next` approaching a collapsed group from before lands ON the group
   *  START (affordance visible); a `next` from at/inside the group exits
   *  past its END. Interior steps are never silently skipped: the first
   *  press always stops at the boundary, and expanding the group (or the
   *  slider / setStep) reaches every raw index (R7 100% reachability).
   *  Grouping semantics untouched (see rebuildCompression). */
  next: () => void;
  /** Mirror of `next`: `prev` approaching a collapsed group from after
   *  lands ON the group END; a `prev` from at/inside exits before its
   *  START. Grouping semantics untouched (see rebuildCompression). */
  prev: () => void;
  /** Re-scan the trace and regenerate compressedSteps. */
  rebuildCompression: () => void;
  /** Toggle expand/collapse for a compressed group. */
  toggleExpand: (startStep: number) => void;
  /** Reset to initial state. */
  reset: () => void;

  // ── Streaming support ──────────────────────────────────────────────────

  /** Append a single trace event from the NDJSON stream (O(1) call‑stack). */
  appendEvent: (event: TraceEvent) => void;
  /** Finalise the stream — rebuilds compression and marks streaming as done. */
  streamComplete: (meta: { total_steps: number }) => void;
  /** Handle an error received during streaming — resets trace state. */
  streamError: () => void;
}

export const useTraceStore = create<TraceStore>((set, get) => ({
  trace: [],
  totalSteps: 0,
  currentStep: 0,
  currentEvent: null,
  callStack: [],
  compressedSteps: [],
  expandedGroups: [],
  isStreaming: false,
  lastLiveByFrame: {},

  loadTrace: (trace) => {
    const compressedSteps = rebuildCompression(trace);
    set({
      trace,
      totalSteps: trace.length,
      currentStep: 0,
      currentEvent: trace[0] ?? null,
      callStack: rebuildCallStack(trace, 0),
      compressedSteps,
      expandedGroups: [],
      isStreaming: false,
      lastLiveByFrame: buildLiveCache(trace, 0),
    });
  },

  // ── Streaming append ──────────────────────────────────────────────────────

  appendEvent: (event) => {
    const { trace, callStack, lastLiveByFrame } = get();
    const newTrace = [...trace, event];
    const newStack = [...callStack];
    applyEvent(newStack, event, true);

    const live = liveVarsOf(event);
    const nextCache =
      live !== null
        ? {
            ...lastLiveByFrame,
            [frameKey(event.func, event.depth)]: {
              vars: live,
              step: newTrace.length - 1,
            },
          }
        : lastLiveByFrame;

    set({
      trace: newTrace,
      totalSteps: newTrace.length,
      currentEvent: trace.length === 0 ? event : get().currentEvent,
      callStack: newStack,
      isStreaming: true,
      lastLiveByFrame: nextCache,
    });
  },

  streamComplete: (meta) => {
    const { trace } = get();
    const compressedSteps = rebuildCompression(trace);

    set({
      isStreaming: false,
      compressedSteps,
      totalSteps: meta.total_steps,
      // Set currentStep to 0 and currentEvent if not yet set (streaming never positioned)
      currentStep: 0,
      currentEvent: trace[0] ?? null,
      lastLiveByFrame: buildLiveCache(trace, 0),
      callStack: rebuildCallStack(trace, 0),
    });
  },

  streamError: () => {
    set({
      isStreaming: false,
      trace: [],
      totalSteps: 0,
      currentStep: 0,
      currentEvent: null,
      callStack: [],
      compressedSteps: [],
      expandedGroups: [],
      lastLiveByFrame: {},
    });
  },

  setStep: (n) => {
    const { trace, currentStep, callStack } = get();
    const clamped = Math.max(0, Math.min(n, trace.length - 1));
    if (clamped === currentStep) return;

    const newStack = [...callStack];
    if (clamped > currentStep) {
      for (let i = currentStep + 1; i <= clamped; i++) {
        applyEvent(newStack, trace[i], true);
      }
    } else {
      for (let i = currentStep; i > clamped; i--) {
        applyEvent(newStack, trace[i], false);
      }
    }

    set({
      currentStep: clamped,
      currentEvent: trace[clamped] ?? null,
      callStack: newStack,
      lastLiveByFrame: buildLiveCache(trace, clamped),
    });
  },

  next: () => {
    const {
      currentStep,
      trace,
      callStack,
      compressedSteps,
      expandedGroups,
      lastLiveByFrame,
    } = get();
    if (currentStep >= trace.length - 1) return;

    let nextStep = currentStep + 1;

    // Land on collapsed-group boundaries instead of skipping over them:
    // approaching from before the group lands on its start (affordance
    // visible); already at/inside lands past the group end.
    const group = groupContaining(compressedSteps, nextStep, expandedGroups);
    if (group) {
      nextStep =
        currentStep < group.startStep ? group.startStep : group.endStep + 1;
    }

    if (nextStep >= trace.length) return;

    const newStack = [...callStack];
    for (let i = currentStep + 1; i <= nextStep; i++) {
      applyEvent(newStack, trace[i], true);
    }

    const landed = trace[nextStep];
    const live = liveVarsOf(landed);
    const nextCache =
      live !== null
        ? {
            ...lastLiveByFrame,
            [frameKey(landed.func, landed.depth)]: { vars: live, step: nextStep },
          }
        : lastLiveByFrame;

    set({
      currentStep: nextStep,
      currentEvent: trace[nextStep],
      callStack: newStack,
      lastLiveByFrame: nextCache,
    });
  },

  prev: () => {
    const {
      currentStep,
      trace,
      callStack,
      compressedSteps,
      expandedGroups,
      lastLiveByFrame,
    } = get();
    if (currentStep <= 0) return;

    let prevStep = currentStep - 1;

    // Land on collapsed-group boundaries instead of skipping over them:
    // approaching from after the group lands on its end (affordance
    // visible); already at/inside lands before the group start.
    const group = groupContaining(compressedSteps, prevStep, expandedGroups);
    if (group) {
      prevStep =
        currentStep > group.endStep ? group.endStep : group.startStep - 1;
    }

    if (prevStep < 0) return;

    const newStack = [...callStack];
    for (let i = currentStep; i > prevStep; i--) {
      applyEvent(newStack, trace[i], false);
    }

    const landed = trace[prevStep];
    const live = liveVarsOf(landed);
    let prevCache = lastLiveByFrame;
    if (live !== null) {
      prevCache = {
        ...lastLiveByFrame,
        [frameKey(landed.func, landed.depth)]: { vars: live, step: prevStep },
      };
    } else {
      const scanned = findLastLiveSnapshot(
        trace,
        prevStep,
        landed.func,
        landed.depth,
      );
      const key = frameKey(landed.func, landed.depth);
      if (scanned !== null) {
        prevCache = { ...lastLiveByFrame, [key]: scanned };
      } else {
        prevCache = { ...lastLiveByFrame };
        delete prevCache[key];
      }
    }

    set({
      currentStep: prevStep,
      currentEvent: trace[prevStep],
      callStack: newStack,
      lastLiveByFrame: prevCache,
    });
  },

  rebuildCompression: () => {
    const { trace } = get();
    set({ compressedSteps: rebuildCompression(trace) });
  },

  toggleExpand: (startStep) => {
    const { expandedGroups } = get();
    const next = expandedGroups.includes(startStep)
      ? expandedGroups.filter((s) => s !== startStep)
      : [...expandedGroups, startStep];
    set({ expandedGroups: next });
  },

  reset: () =>
    set({
      trace: [],
      totalSteps: 0,
      currentStep: 0,
      currentEvent: null,
      callStack: [],
      compressedSteps: [],
      expandedGroups: [],
      lastLiveByFrame: {},
    }),
}));
