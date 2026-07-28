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

export function CallStackView() {
  const callStack = useTraceStore((s) => s.callStack);

  // callStack is stored in chronological order (deepest call last).
  // Reverse for display so the most recent call is at the top.
  const frames = useMemo(() => [...callStack].reverse(), [callStack]);

  if (frames.length === 0) return null;

  return (
    <div className="border-t border-zinc-800">
      <div className="px-3 py-1.5 flex items-center justify-between">
        <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wide">
          Call Stack
        </span>
        <span className="text-[10px] text-zinc-600">{frames.length} frame{frames.length !== 1 ? "s" : ""}</span>
      </div>
      <div className="overflow-y-auto max-h-[120px]">
        {frames.map((frame, i) => (
          <div
            key={i}
            className={`flex items-center gap-2 px-3 py-1 border-b border-zinc-800/50 ${
              i === 0 ? "bg-zinc-800/40" : ""
            }`}
          >
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
            <span className="text-[11px] font-mono text-zinc-300 truncate">
              {frame.func}()
            </span>
            <span className="text-[10px] text-zinc-600 ml-auto shrink-0">
              :{frame.line}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
