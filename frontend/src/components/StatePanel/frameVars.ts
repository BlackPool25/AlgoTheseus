/**
 * components/StatePanel/frameVars.ts — Frontend mirror of the parser-side
 * `stack_to_render(events, step)` slice (todo 9): latest-known vars per
 * stack frame, derived by scanning trace[0..currentStep].
 *
 * ENTER params seed a frame; STATE vars merge over them. Keyed by
 * func@depth so recursion keeps distinct frames.
 */

import type { TraceEvent } from "../../types/trace";

export interface StackFrameInfo {
  func: string;
  depth: number;
  line: number;
}

export interface FrameWithVars extends StackFrameInfo {
  vars: Record<string, unknown>;
}

function key(func: string, depth: number): string {
  return `${func}@${depth}`;
}

/** Latest-known vars for each frame on `callStack` (chronological order). */
export function buildFramesWithVars(
  trace: TraceEvent[],
  currentStep: number,
  callStack: StackFrameInfo[],
): FrameWithVars[] {
  const latest = new Map<string, Record<string, unknown>>();
  const end = Math.min(currentStep, trace.length - 1);
  for (let i = 0; i <= end; i++) {
    const e = trace[i];
    if (e.type === "enter") {
      latest.set(key(e.func, e.depth), { ...e.params });
    } else if (e.type === "state") {
      const k = key(e.func, e.depth);
      latest.set(k, { ...latest.get(k), ...e.vars });
    }
  }
  return callStack.map((f) => ({
    ...f,
    vars: latest.get(key(f.func, f.depth)) ?? {},
  }));
}
