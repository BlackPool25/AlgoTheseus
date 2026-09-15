/**
 * components/ProgramOutputBox.tsx — Cumulative program stdout at the current step.
 *
 * Reads the nearest-backwards STATE `stdout` (backend folds deltas into
 * cumulative per-STATE values, todo 10). Renders nothing when no STATE
 * carries per-step stdout (v1 traces keep the static App banner).
 */

import { useTraceStore } from "../store/traceStore";

export function ProgramOutputBox() {
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

  return (
    <div
      data-testid="program-output"
      className="px-4 py-2 bg-zinc-900 border-t border-zinc-800 text-xs text-zinc-300 font-mono whitespace-pre-wrap max-h-32 overflow-y-auto"
    >
      <span className="text-zinc-500 mr-2">program output:</span>
      {stdout.trim() === "" ? (
        <span className="text-zinc-600">(no output yet)</span>
      ) : (
        stdout.trim()
      )}
      {truncated && <span className="text-amber-400 ml-2">[truncated]</span>}
    </div>
  );
}
