/**
 * components/Editor/InputPanel.tsx — Raw stdin textarea.
 */

import { useUIStore } from "../../store/uiStore";

export function InputPanel() {
  const rawInput = useUIStore((s) => s.rawInput);
  const setRawInput = useUIStore((s) => s.setRawInput);

  return (
    <div className="flex flex-col gap-2 h-full">
      <div className="text-xs font-medium text-viz-ink/60 uppercase tracking-wide">
        stdin (optional)
      </div>
      <textarea
        className="flex-1 bg-viz-body rounded p-2 text-xs text-viz-ink font-mono resize-none outline-none focus:ring-1 focus:ring-viz-line"
        placeholder="Enter program input here..."
        value={rawInput}
        onChange={(e) => setRawInput(e.target.value)}
        spellCheck={false}
      />
    </div>
  );
}
