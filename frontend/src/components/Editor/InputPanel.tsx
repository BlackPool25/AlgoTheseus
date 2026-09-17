/**
 * components/Editor/InputPanel.tsx — Raw stdin textarea with a proactive
 * empty-stdin hint. The hint never blocks a run; the backend owns the 422.
 */

import { useRef } from "react";
import { useUIStore } from "../../store/uiStore";
import { readsStdin } from "../../utils/stdin";

export function InputPanel() {
  const code = useUIStore((s) => s.code);
  const rawInput = useUIStore((s) => s.rawInput);
  const setRawInput = useUIStore((s) => s.setRawInput);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const showEmptyHint = readsStdin(code) && rawInput.trim() === "";

  return (
    <div className="flex flex-col gap-2 h-full">
      <div className="text-xs font-medium text-viz-ink/60 uppercase tracking-wide">
        stdin (optional)
      </div>
      {/* Reserved slot avoids layout shift when the hint appears/disappears */}
      <div aria-live="polite" className="min-h-8 shrink-0">
        {showEmptyHint && (
          <div className="flex items-center gap-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-300">
            <span className="min-w-0 flex-1">
              Reads input (cin/scanf) but stdin is empty — this run will be
              rejected. Paste input below.
            </span>
            <button
              type="button"
              onClick={() => textareaRef.current?.focus()}
              className="shrink-0 rounded px-1.5 py-0.5 font-medium text-amber-200 underline decoration-amber-400/60 underline-offset-2 hover:text-amber-100"
            >
              Focus input
            </button>
          </div>
        )}
      </div>
      <textarea
        ref={textareaRef}
        className="flex-1 bg-viz-body rounded p-2 text-xs text-viz-ink font-mono resize-none outline-none focus:ring-1 focus:ring-viz-line"
        placeholder="Enter program input here..."
        value={rawInput}
        onChange={(e) => setRawInput(e.target.value)}
        spellCheck={false}
      />
    </div>
  );
}
