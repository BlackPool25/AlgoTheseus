/**
 * store/traceStore.ts — Zustand store for trace navigation.
 *
 * Owns: the flat trace array, current step index, current call stack,
 * compressed-step grouping, and navigation actions.  The call stack is
 * maintained *incrementally* during step-by-step navigation (O(1) per
 * step) instead of being rebuilt from scratch on every render.
 *
 * Compression groups consecutive STATE events whose `vars` are identical
 * into a single display group.  Groups can be collapsed (prev/next skip
 * the group) or expanded (individual steps are shown).
 */

import { create } from "zustand";
import type { TraceEvent } from "../types/trace";

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

/** Serialise event.vars to a stable JSON string for comparison. */
function varsKey(event: TraceEvent): string | null {
  if (event.type !== "state") return null;
  return JSON.stringify(event.vars);
}

/**
 * Scan the trace and produce a list of compressed-step groups.
 *
 * Two compression strategies:
 * 1. **Backend metadata** – if an event carries `_group_count` (>1) the
 *    backend already collapsed it; we use the metadata directly.
 * 2. **Frontend detection** – consecutive STATE events whose `vars`
 *    serialise to the same string are grouped.
 *
 * Only STATE events are ever compressed.
 */
function rebuildCompression(trace: TraceEvent[]): CompressedStep[] {
  const groups: CompressedStep[] = [];
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

    // 2. Frontend-side detection (only for STATE events)
    if (event.type !== "state") {
      i++;
      continue;
    }

    const key = varsKey(event);
    let j = i + 1;
    while (j < trace.length) {
      const next = trace[j];
      if (next.type !== "state") break;
      if (varsKey(next) !== key) break;
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

  /** Load a new trace (resets step to 0 and builds the initial stack). */
  loadTrace: (trace: TraceEvent[]) => void;
  /** Jump to a specific step (always works, no group skipping). */
  setStep: (n: number) => void;
  /** Advance one step, skipping collapsed compressed groups. */
  next: () => void;
  /** Go back one step, skipping collapsed compressed groups. */
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
    });
  },

  // ── Streaming append ──────────────────────────────────────────────────────

  appendEvent: (event) => {
    const { trace, callStack } = get();
    const newTrace = [...trace, event];
    const newStack = [...callStack];
    applyEvent(newStack, event, true);

    set({
      trace: newTrace,
      totalSteps: newTrace.length,
      currentEvent: trace.length === 0 ? event : get().currentEvent,
      callStack: newStack,
      isStreaming: true,
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
    });
  },

  next: () => {
    const { currentStep, trace, callStack, compressedSteps, expandedGroups } =
      get();
    if (currentStep >= trace.length - 1) return;

    let nextStep = currentStep + 1;

    // Skip collapsed compressed groups
    const group = groupContaining(compressedSteps, nextStep, expandedGroups);
    if (group) {
      nextStep = group.endStep + 1;
    }

    if (nextStep >= trace.length) return;

    const newStack = [...callStack];
    for (let i = currentStep + 1; i <= nextStep; i++) {
      applyEvent(newStack, trace[i], true);
    }

    set({
      currentStep: nextStep,
      currentEvent: trace[nextStep],
      callStack: newStack,
    });
  },

  prev: () => {
    const { currentStep, trace, callStack, compressedSteps, expandedGroups } =
      get();
    if (currentStep <= 0) return;

    let prevStep = currentStep - 1;

    // Skip collapsed compressed groups
    const group = groupContaining(compressedSteps, prevStep, expandedGroups);
    if (group) {
      prevStep = group.startStep - 1;
    }

    if (prevStep < 0) return;

    const newStack = [...callStack];
    for (let i = currentStep; i > prevStep; i--) {
      applyEvent(newStack, trace[i], false);
    }

    set({
      currentStep: prevStep,
      currentEvent: trace[prevStep],
      callStack: newStack,
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
    }),
}));
