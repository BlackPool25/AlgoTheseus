/**
 * components/ProgramOutputBox.tsx — Cumulative program stdout at the current step.
 *
 * Reads the nearest-backwards STATE `stdout` (backend folds deltas into
 * cumulative per-STATE values, todo 10). Renders nothing when no STATE
 * carries per-step stdout (v1 traces keep the static App banner).
 */

import { useTraceStore } from "../store/traceStore";

export const SHOW_OUTPUT_EVENT = "algo:show-output";

export function ProgramOutputBox({ variant = "full" }: { variant?: "full" | "status" }) {
  const { trace, currentStep, currentEvent } = useTraceStore();

  let stdout: string | null = null;
  const end = Math.min(currentStep, trace.length - 1);
  for (let i = end; i >= 0; i--) {
    const e = trace[i];
    if (e.type === "state" && typeof e.stdout === "string") {
      stdout = e.stdout;
      break;
    }
  }
  if (stdout == null) return null;

  const truncated =
    currentEvent?.type === "state" && currentEvent.stdout_truncated === true;

  if (variant === "status") {
    const text = stdout.trim() === "" ? "(no output yet)" : stdout.trim();
    return (
      <button
        data-testid="program-output"
        onClick={() => window.dispatchEvent(new CustomEvent(SHOW_OUTPUT_EVENT))}
        className="w-full px-4 py-1.5 bg-viz-body border-t border-viz-line text-[11px] text-viz-ink/60 font-mono truncate text-left hover:text-viz-ink transition-colors"
        title="View program output in the Output tab"
      >
        <span className="mr-2">program output:</span>
        <span className="text-viz-ink/80">{text}</span>
        <span className="ml-2 text-amber-400/80">· view in Output tab →</span>
        {truncated && <span className="text-amber-400 ml-2">[truncated]</span>}
      </button>
    );
  }

  return (
    <div
      data-testid="program-output"
      className="px-4 py-2 bg-viz-body border-t border-viz-line text-xs text-viz-ink font-mono whitespace-pre-wrap max-h-32 overflow-y-auto"
    >
      <span className="text-viz-ink/60 mr-2">program output:</span>
      {stdout.trim() === "" ? (
        <span className="text-viz-ink/60">(no output yet)</span>
      ) : (
        stdout.trim()
      )}
      {truncated && <span className="text-amber-400 ml-2">[truncated]</span>}
    </div>
  );
}
