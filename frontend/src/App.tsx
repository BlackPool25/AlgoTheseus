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

import { useRef, useState } from "react";
import { useCFGStore } from "./store/cfgStore";
import { useTraceStore } from "./store/traceStore";
import { useUIStore } from "./store/uiStore";
import { streamExecute } from "./utils/api";
import type { StreamCallbacks } from "./utils/api";
import { CodeEditor } from "./components/Editor/CodeEditor";
import { InputPanel } from "./components/Editor/InputPanel";
import { TestCaseManager } from "./components/Editor/TestCaseManager";
import { TraceScrubber } from "./components/Scrubber/TraceScrubber";
import { StatePanel } from "./components/StatePanel/StatePanel";
import { TraceFlow } from "./components/FlowChart/TraceFlow";
import { Splitter } from "./components/Layout/Splitter";

const MIN_EDITOR_W = 320;
const MIN_CFG_W = 320;
const MIN_STATE_W = 220;
const MAX_STATE_W = 480;
const MIN_INPUT_H = 140;
const MIN_EDITOR_H = 200;

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

  async function handleExecute() {
    const uiStore = useUIStore.getState();
    const traceStore = useTraceStore.getState();
    const cfgStore = useCFGStore.getState();

    uiStore.setStatus("executing");
    traceStore.reset();
    cfgStore.reset();

    const callbacks: StreamCallbacks = {
      onEvent: (event) => traceStore.appendEvent(event),
      onCFG: (cfg) => {
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
    };

    streamExecute({ code, raw_stdin: rawInput }, callbacks);
  }

  const isLoading = status === "executing";

  const mainRef = useRef<HTMLDivElement>(null);
  const leftColRef = useRef<HTMLDivElement>(null);

  // null = default size (first paint matches the old fixed layout).
  const [leftW, setLeftW] = useState<number | null>(null);
  const [inputH, setInputH] = useState<number | null>(null);
  const [stateW, setStateW] = useState<number | null>(null);

  const mainW = () => mainRef.current?.clientWidth ?? window.innerWidth;

  const dragLeft = (dx: number) => {
    setLeftW((prev) => {
      const cur = prev ?? (leftColRef.current?.clientWidth || 0);
      const max = mainW() - MIN_CFG_W - MIN_STATE_W - 8;
      return Math.min(Math.max(cur + dx, MIN_EDITOR_W), Math.max(max, MIN_EDITOR_W));
    });
  };

  const dragInput = (_dx: number, dy: number) => {
    setInputH((prev) => {
      const colH = leftColRef.current?.clientHeight ?? window.innerHeight;
      const cur = prev ?? 360;
      const max = colH - MIN_EDITOR_H;
      return Math.min(Math.max(cur - dy, MIN_INPUT_H), Math.max(max, MIN_INPUT_H));
    });
  };

  const dragState = (dx: number) => {
    setStateW((prev) => {
      const cur = prev ?? 260;
      const rightW = mainW() - (leftColRef.current?.clientWidth || 0);
      const max = Math.min(MAX_STATE_W, rightW - MIN_CFG_W - 8);
      return Math.min(Math.max(cur - dx, MIN_STATE_W), Math.max(max, MIN_STATE_W));
    });
  };

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 bg-zinc-900 border-b border-zinc-800 shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold text-zinc-100">DSA Visualiser</h1>
          <span className="text-xs bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded font-mono">C++ · libclang</span>
        </div>
        <div className="flex items-center gap-2">
          {status === "done" && (
            <button
              onClick={() => { reset(); useTraceStore.getState().reset(); useCFGStore.getState().reset(); }}
              className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
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
      <div ref={mainRef} className="flex flex-1 overflow-hidden">
        {/* Left panel: editor + input */}
        <div
          ref={leftColRef}
          className="flex flex-col shrink-0 min-w-0 overflow-hidden"
          style={{ width: leftW ?? "45%" }}
        >
          <div className="flex-1 min-h-0 overflow-hidden">
            <CodeEditor />
          </div>
          <Splitter direction="horizontal" onDrag={dragInput} label="Resize input area" />
          <div
            className="flex flex-col shrink-0 overflow-hidden"
            style={{ height: inputH ?? 360 }}
          >
            <div className="flex-1 overflow-y-auto p-3 border-b border-zinc-800">
              <InputPanel />
            </div>
            <div className="overflow-y-auto p-3">
              <TestCaseManager />
            </div>
          </div>
        </div>

        <Splitter direction="vertical" onDrag={dragLeft} label="Resize editor area" />

        {/* Right panel: CFG + state */}
        <div className="flex flex-1 min-w-0 overflow-hidden">
          {/* CFG */}
          <div className="flex-1 min-w-0 overflow-hidden">
            <TraceFlow />
          </div>
          <Splitter direction="vertical" onDrag={dragState} label="Resize state panel" />
          {/* State panel */}
          <div
            className="shrink-0 overflow-hidden"
            style={{ width: stateW ?? 260 }}
          >
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

      {/* Stdout banner */}
      {stdout && status === "done" && (
        <div className="px-4 py-2 bg-zinc-900 border-t border-zinc-800 text-xs text-zinc-300 font-mono">
          <span className="text-zinc-500 mr-2">stdout:</span>{stdout.trim()}
        </div>
      )}

      {/* Scrubber */}
      <TraceScrubber />
    </div>
  );
}
