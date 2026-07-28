/**
 * components/Editor/InputPanel.tsx — Raw stdin textarea.
 */

import { useUIStore } from "../../store/uiStore";

export function InputPanel() {
  const rawInput = useUIStore((s) => s.rawInput);
  const setRawInput = useUIStore((s) => s.setRawInput);

  return (
    <div className="flex flex-col gap-2 h-full">
      <div className="text-xs font-medium text-zinc-400 uppercase tracking-wide">
        stdin (optional)
      </div>
      <textarea
        className="flex-1 bg-zinc-900 rounded p-2 text-xs text-zinc-300 font-mono resize-none outline-none focus:ring-1 focus:ring-zinc-600"
        placeholder="Enter program input here..."
        value={rawInput}
        onChange={(e) => setRawInput(e.target.value)}
        spellCheck={false}
      />
    </div>
  );
}
