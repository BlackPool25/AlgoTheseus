/**
 * App.tsx — Root component. Wires stores, API calls, and layout.
 *
 * Layout:
 *   ┌─────────────────────────────────────────────────────┐
 *   │  Header: title + Run button                         │
 *   ├──────────────────────┬──────────────────────────────┤
 *   │  Left: CodeEditor    │  Right: CFG (TraceFlow)      │
 *   │        InputPanel    │         StatePanel           │
 *   ├──────────────────────┴──────────────────────────────┤
 *   │  Bottom: TraceScrubber                              │
 *   └─────────────────────────────────────────────────────┘
 *
 * User flow:
 *   1. User writes code + optional raw stdin.
 *   2. Clicks "Run" → POST /execute → loads trace + CFG.
 *   3. User scrubs through the trace.
 */

import { useState } from "react";
import { useCFGStore } from "./store/cfgStore";
import { useTraceStore } from "./store/traceStore";
import { useUIStore } from "./store/uiStore";
import { THEMES, applyTheme, currentTheme, type ThemeName } from "./theme";
import { streamExecute } from "./utils/api";
import type { StreamCallbacks } from "./utils/api";
import { CodeEditor } from "./components/Editor/CodeEditor";
import { InputPanel } from "./components/Editor/InputPanel";
import { TestCaseManager } from "./components/Editor/TestCaseManager";
import { TraceScrubber } from "./components/Scrubber/TraceScrubber";
import { StatePanel } from "./components/StatePanel/StatePanel";
import { ProgramOutputBox } from "./components/ProgramOutputBox";
import { TraceFlow } from "./components/FlowChart/TraceFlow";

export default function App() {
  const {
    code,
    rawInput,
    status,
    errorMessage,
    stdout,
    compileError,
    runtimeError,
  } = useUIStore();
  const { reset } = useUIStore();
  const [theme, setTheme] = useState<ThemeName>(() => currentTheme());
  const trace = useTraceStore((s) => s.trace);
  // Per-step stdout present → ProgramOutputBox owns output; else static banner.
  const hasPerStepStdout = trace.some(
    (e) => e.type === "state" && typeof e.stdout === "string",
  );

  async function handleExecute() {
    const uiStore = useUIStore.getState();
    const traceStore = useTraceStore.getState();
    const cfgStore = useCFGStore.getState();

    uiStore.setStatus("executing");
    traceStore.reset();
    cfgStore.reset();

    let cfgReceived = false;

    const callbacks: StreamCallbacks = {
      onEvent: (event) => traceStore.appendEvent(event),
      onCFG: (cfg) => {
        cfgReceived = true;
        cfgStore.loadCFG(cfg.cfg_nodes, cfg.cfg_edges);
        traceStore.streamComplete({ total_steps: cfg.total_steps });
        uiStore.setExecuteResult(
          cfg.stdout,
          null,
          cfg.runtime_error,
          cfg.truncated,
        );
      },
      onError: (err) => {
        traceStore.streamError();
        if (err.compile_error) {
          uiStore.setExecuteResult("", err.compile_error, null);
        } else {
          uiStore.setError(err.runtime_error ?? "Unknown streaming error");
        }
      },
      // The stream reader resolves cleanly even when the connection drops
      // before the final cfg line. Without this, status stays "executing"
      // forever (no banner, Run stuck on "Running…").
      onDone: () => {
        if (!cfgReceived && useUIStore.getState().status === "executing") {
          traceStore.streamError();
          uiStore.setError(
            "Stream ended unexpectedly before the trace completed — try running again.",
          );
        }
      },
    };

    streamExecute({ code, raw_stdin: rawInput }, callbacks);
  }

  const isLoading = status === "executing";

  return (
    <div className="flex flex-col h-screen bg-viz-body text-viz-ink">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 bg-viz-body border-b border-viz-line shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold text-viz-ink">DSA Visualiser</h1>
          <span className="text-xs bg-viz-panel text-viz-ink/60 px-2 py-0.5 rounded font-mono">C++ · libclang</span>
        </div>
        <div className="flex items-center gap-2">
          <select
            aria-label="Theme"
            value={theme}
            onChange={(e) => setTheme(applyTheme(e.target.value))}
            className="text-xs bg-viz-panel text-viz-ink/60 px-2 py-1 rounded font-mono"
          >
            {THEMES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          {status === "done" && (
            <button
              onClick={() => { reset(); useTraceStore.getState().reset(); useCFGStore.getState().reset(); }}
              className="text-xs text-viz-ink/60 hover:text-viz-ink transition-colors"
            >
              Reset
            </button>
          )}
          <button
            onClick={handleExecute}
            disabled={isLoading}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded px-4 py-1.5 transition-colors"
          >
            {isLoading ? "Running…" : "Run"}
          </button>
        </div>
      </header>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel: editor + input */}
        <div className="flex flex-col w-[45%] border-r border-viz-line">
          <div className="flex-1 overflow-hidden">
            <CodeEditor />
          </div>
          <div className="h-[360px] border-t border-viz-line flex flex-col">
            <div className="flex-1 overflow-y-auto p-3 border-b border-viz-line">
              <InputPanel />
            </div>
            <div className="overflow-y-auto p-3">
              <TestCaseManager />
            </div>
          </div>
        </div>

        {/* Right panel: CFG + state */}
        <div className="flex flex-1 overflow-hidden">
          {/* CFG */}
          <div className="flex-1 overflow-hidden">
            <TraceFlow />
          </div>
          {/* State panel */}
          <div className="w-[260px] border-l border-viz-line overflow-hidden">
            <StatePanel />
          </div>
        </div>
      </div>

      {/* Error / compile error banner */}
      {(errorMessage || compileError || runtimeError) && (
        <div className="px-4 py-2 bg-red-900/30 border-t border-red-800 text-xs text-red-300 font-mono whitespace-pre-wrap max-h-32 overflow-y-auto">
          {compileError || runtimeError || errorMessage}
        </div>
      )}

      {/* Stdout banner (retired when per-step stdout present) */}
      {hasPerStepStdout ? (
        <ProgramOutputBox />
      ) : (
        stdout &&
        status === "done" && (
          <div className="px-4 py-2 bg-viz-body border-t border-viz-line text-xs text-viz-ink font-mono">
            <span className="text-viz-ink/60 mr-2">stdout:</span>{stdout.trim()}
          </div>
        )
      )}

      {/* Scrubber */}
      <TraceScrubber />
    </div>
  );
}
