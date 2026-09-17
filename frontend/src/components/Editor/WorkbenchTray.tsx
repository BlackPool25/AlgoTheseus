/**
 * components/Editor/WorkbenchTray.tsx — Tabbed drawer for STDIN, Batch Tests, and Output.
 *
 * Replaces the cramped vertical stack with a clean, collapsible tabbed interface.
 */

import { useEffect, useState } from "react";
import { Terminal, FlaskConical, AlignLeft, ChevronDown, ChevronUp } from "lucide-react";
import { InputPanel } from "./InputPanel";
import { TestCaseManager } from "./TestCaseManager";
import { ProgramOutputBox, SHOW_OUTPUT_EVENT } from "../ProgramOutputBox";
import { useUIStore } from "../../store/uiStore";

type TabId = "stdin" | "batch" | "stdout";

interface WorkbenchTrayProps {
  onToggleCollapse?: () => void;
  isCollapsed?: boolean;
  segmented?: boolean;
}

export function WorkbenchTray({ onToggleCollapse, isCollapsed = false, segmented = false }: WorkbenchTrayProps) {
  const [activeTab, setActiveTab] = useState<TabId>("stdin");
  const rawInput = useUIStore((s) => s.rawInput);
  const stdout = useUIStore((s) => s.stdout);
  const status = useUIStore((s) => s.status);
  const [outputSeen, setOutputSeen] = useState(true);

  useEffect(() => {
    if (status === "executing") setOutputSeen(false);
  }, [status]);

  useEffect(() => {
    if (activeTab === "stdout") setOutputSeen(true);
  }, [activeTab]);

  const showRunDot = !outputSeen && (status === "done" || status === "error");

  // The fixed bottom status bar links here — it owns no output itself.
  useEffect(() => {
    const jump = () => setActiveTab("stdout");
    window.addEventListener(SHOW_OUTPUT_EVENT, jump);
    return () => window.removeEventListener(SHOW_OUTPUT_EVENT, jump);
  }, []);

  return (
    <div className="flex flex-col h-full bg-viz-body text-viz-ink select-none">
      {/* Tab bar header — segmented Input | Batch | Output on mobile */}
      <div className="flex items-center justify-between px-2 py-1 bg-viz-panel/50 border-b border-viz-line shrink-0">
        <div
          role="tablist"
          aria-label="Input, batch tests, and output"
          className={
            segmented
              ? "flex flex-1 items-center gap-1 rounded-lg bg-viz-body border border-viz-line p-1"
              : "flex items-center gap-1"
          }
        >
          <button
            role="tab"
            aria-selected={activeTab === "stdin"}
            onClick={() => setActiveTab("stdin")}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded transition-colors ${
              segmented ? "flex-1 justify-center min-h-[44px]" : ""
            } ${
              activeTab === "stdin"
                ? "bg-viz-panel text-amber-400 font-medium shadow-xs"
                : "text-viz-ink/60 hover:text-viz-ink"
            }`}
          >
            <AlignLeft className="w-3.5 h-3.5" />
            <span>{segmented ? "Input" : "Input (stdin)"}</span>
            {rawInput.trim().length > 0 && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            )}
          </button>

          <button
            role="tab"
            aria-selected={activeTab === "batch"}
            onClick={() => setActiveTab("batch")}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded transition-colors ${
              segmented ? "flex-1 justify-center min-h-[44px]" : ""
            } ${
              activeTab === "batch"
                ? "bg-viz-panel text-amber-400 font-medium shadow-xs"
                : "text-viz-ink/60 hover:text-viz-ink"
            }`}
          >
            <FlaskConical className="w-3.5 h-3.5" />
            <span>{segmented ? "Batch" : "Batch Tests"}</span>
          </button>

          <button
            role="tab"
            aria-selected={activeTab === "stdout"}
            onClick={() => setActiveTab("stdout")}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded transition-colors ${
              segmented ? "flex-1 justify-center min-h-[44px] relative" : "relative"
            } ${
              activeTab === "stdout"
                ? "bg-viz-panel text-amber-400 font-medium shadow-xs"
                : "text-viz-ink/60 hover:text-viz-ink"
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>Output</span>
            {showRunDot ? (
              <span
                aria-label="New run output"
                title="Run finished — new output"
                className="w-2 h-2 rounded-full bg-amber-400"
              />
            ) : (
              stdout.trim().length > 0 &&
              status === "done" && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              )
            )}
          </button>
        </div>

        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            className="p-1 text-viz-ink/50 hover:text-viz-ink transition-colors rounded hover:bg-viz-panel"
            title={isCollapsed ? "Expand drawer" : "Collapse drawer"}
          >
            {isCollapsed ? (
              <ChevronUp className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
          </button>
        )}
      </div>

      {/* Tab content area */}
      {!isCollapsed && (
        <div className="flex-1 overflow-y-auto p-3 min-h-0">
          {activeTab === "stdin" && <InputPanel />}
          {activeTab === "batch" && <TestCaseManager />}
          {activeTab === "stdout" && (
            <div className="flex flex-col gap-2">
              <ProgramOutputBox />
              {stdout && status === "done" && (
                <div className="p-2.5 rounded bg-viz-panel border border-viz-line font-mono text-xs text-viz-ink whitespace-pre-wrap">
                  <div className="text-[10px] text-viz-ink/50 uppercase font-semibold mb-1">
                    Complete Run Output:
                  </div>
                  {stdout}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
