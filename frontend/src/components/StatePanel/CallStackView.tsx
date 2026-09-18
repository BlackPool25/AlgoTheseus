/**
 * components/StatePanel/CallStackView.tsx — Current call stack as a list.
 *
 * Reconstructs the call stack by scanning backwards through the trace
 * from the current step, collecting FUNC_ENTER events that haven't been
 * matched by a FUNC_EXIT.
 *
 * Shows: [depth] funcName() · line N
 * Most recent call at the top.
 */

import { useMemo } from "react";
import { useTraceStore } from "../../store/traceStore";
import { renderCellValue } from "../../utils/format";
import { buildFramesWithVars, type StackFrameInfo } from "./frameVars";
import type { TraceEvent } from "../../types/trace";

export function CallStackView() {
  const callStack = useTraceStore((s) => s.callStack);
  const trace = useTraceStore((s) => s.trace);
  const currentStep = useTraceStore((s) => s.currentStep);

  return (
    <CallStackFrames trace={trace} currentStep={currentStep} callStack={callStack} />
  );
}

export function CallStackFrames({
  trace,
  currentStep,
  callStack,
}: {
  trace: TraceEvent[];
  currentStep: number;
  callStack: StackFrameInfo[];
}) {
  // callStack is stored in chronological order (deepest call last).
  // Reverse for display so the most recent call is at the top.
  const frames = useMemo(
    () => buildFramesWithVars(trace, currentStep, callStack).reverse(),
    [trace, currentStep, callStack],
  );
  // Live position of the current step — the top (most recent) frame executes
  // here, so its line tracks the scrubber; caller frames keep enter-time.
  const liveLine = trace[currentStep]?.line ?? null;

  if (frames.length === 0) return null;

  return (
    <div className="border-t border-viz-line">
      <div className="px-3 py-1.5 flex items-center justify-between">
        <span className="text-[10px] font-medium text-viz-ink/60 uppercase tracking-wide">
          Call Stack
        </span>
        <span className="text-[10px] text-viz-ink/60">{frames.length} frame{frames.length !== 1 ? "s" : ""}</span>
      </div>
      <div className="overflow-y-auto max-h-[120px]">
        {frames.map((frame, i) => (
          <div
            key={i}
            className={`flex flex-col px-3 py-1 border-b border-viz-line/50 ${
              i === 0 ? "bg-viz-panel/40" : ""
            }`}
          >
            <div className="flex items-center gap-2">
              {/* Depth indicator */}
              <div
                className="w-4 h-4 rounded-sm flex items-center justify-center text-[9px] font-mono shrink-0"
                style={{
                  background: `hsl(${200 + frame.depth * 30}, 60%, 25%)`,
                  color: `hsl(${200 + frame.depth * 30}, 80%, 70%)`,
                }}
              >
                {frame.depth}
              </div>
              <span className="text-[11px] font-mono text-viz-ink truncate">
                {frame.func}()
              </span>
              <span className="text-[10px] text-viz-ink/60 ml-auto shrink-0">
                :{i === 0 && liveLine !== null ? liveLine : frame.line}
              </span>
            </div>
            {Object.keys(frame.vars).length > 0 && (
              <div className="flex flex-wrap gap-1 mt-0.5 ml-6">
                {Object.entries(frame.vars).map(([name, value]) => (
                  <span
                    key={name}
                    title={fullValue(value)}
                    className="text-[10px] font-mono text-viz-ink/60 bg-viz-panel/60 rounded px-1"
                  >
                    {name}={renderCellValue(value)}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Untruncated hover text for a chip (renderCellValue truncates the label). */
function fullValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
