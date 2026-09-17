/**
 * App.tsx — Root component. Wires stores, API calls, and adaptive workbench layout.
 *
 * Layout modes:
 *   Desktop (>= 768px): Resizable 3-pane workbench:
 *     [Editor + Tabbed I/O Tray] | [CFG Flow Canvas] | [Variable State Inspector]
 *   Mobile (< 768px): Single-panel adaptive view with top segmented switcher:
 *     [Code] | [Flow Graph] | [Variables] | [Console / I/O]
 *   Both modes retain persistent thumb-friendly playback scrubber and header.
 */

import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Code2, GitFork, Layers, Terminal } from "lucide-react";
import { useCFGStore } from "./store/cfgStore";
import { useTraceStore } from "./store/traceStore";
import { useUIStore } from "./store/uiStore";
import { applyTheme, currentTheme, type ThemeName } from "./theme";
import { streamExecute } from "./utils/api";
import type { StreamCallbacks } from "./utils/api";
import { loadWasmToolchain, selectEngine } from "./utils/executionEngine";
import { WorkbenchTray } from "./components/Editor/WorkbenchTray";
import { TraceScrubber } from "./components/Scrubber/TraceScrubber";
import { ProgramOutputBox, SHOW_OUTPUT_EVENT } from "./components/ProgramOutputBox";
import { Splitter } from "./components/Layout/Splitter";
import { Header } from "./components/Layout/Header";
import { Footer } from "./components/Layout/Footer";
import {
  CfgSkeleton,
  EditorSkeleton,
  StatePanelSkeleton,
} from "./components/Loading/Skeletons";

// Heavy visual modules are split out with Suspense fallbacks
const CodeEditor = lazy(() =>
  import("./components/Editor/CodeEditor").then((m) => ({ default: m.CodeEditor })),
);
const TraceFlow = lazy(() =>
  import("./components/FlowChart/TraceFlow").then((m) => ({ default: m.TraceFlow })),
);
const StatePanel = lazy(() =>
  import("./components/StatePanel/StatePanel").then((m) => ({ default: m.StatePanel })),
);

const MIN_EDITOR_W = 280;
const MIN_CFG_W = 260;
const MIN_STATE_W = 220;
const MIN_INPUT_H = 120;
const MIN_EDITOR_H = 160;

type MobileTab = "code" | "flow" | "state" | "console";

export default function App() {
  const {
    code,
    rawInput,
    status,
    errorMessage,
    stdout,
    compileError,
    runtimeError,
    warnings,
  } = useUIStore();
  const [theme, setTheme] = useState<ThemeName>(() => currentTheme());
  const engineSel = useMemo(() => selectEngine(), []);
  const trace = useTraceStore((s) => s.trace);
  const cfgNodeCount = useCFGStore((s) => s.nodes.length);
  const hasPerStepStdout = trace.some(
    (e) => e.type === "state" && typeof e.stdout === "string",
  );

  // Responsive mobile breakpoint detection
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.innerWidth < 768;
  });
  const [mobileTab, setMobileTab] = useState<MobileTab>("code");
  const [ioSeen, setIoSeen] = useState(true);

  const [prevStatus, setPrevStatus] = useState(status);
  if (prevStatus !== status) {
    setPrevStatus(status);
    if (status === "executing") setIoSeen(false);
  }

  const [prevMobileTab, setPrevMobileTab] = useState(mobileTab);
  if (prevMobileTab !== mobileTab) {
    setPrevMobileTab(mobileTab);
    if (mobileTab === "console") setIoSeen(true);
  }

  const showIoDot = !ioSeen && (status === "done" || status === "error");

  useEffect(() => {
    function handleResize() {
      setIsMobile(window.innerWidth < 768);
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Fixed output bar is a status link only — the Output tab owns the full
  // output. Jumping focuses the tray (mobile: switch to the console tab).
  useEffect(() => {
    const jump = () => {
      if (window.innerWidth < 768) setMobileTab("console");
    };
    window.addEventListener(SHOW_OUTPUT_EVENT, jump);
    return () => window.removeEventListener(SHOW_OUTPUT_EVENT, jump);
  }, []);

  async function handleExecute() {
    const uiStore = useUIStore.getState();
    const traceStore = useTraceStore.getState();
    const cfgStore = useCFGStore.getState();

    uiStore.setStatus("executing");
    traceStore.reset();
    cfgStore.reset();

    if (engineSel.engine === "browser-wasm") {
      loadWasmToolchain().then(
        () => undefined,
        (e: unknown) => {
          traceStore.streamError();
          uiStore.setError(e instanceof Error ? e.message : String(e));
        },
      );
      return;
    }

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
          cfg.warnings ?? [],
        );
        // On mobile, automatically show graph flow once trace loads
        if (window.innerWidth < 768) {
          setMobileTab("flow");
        }
      },
      onError: (err) => {
        traceStore.streamError();
        if (err.compile_error) {
          uiStore.setExecuteResult("", err.compile_error, null);
        } else {
          uiStore.setError(err.runtime_error ?? "Unknown streaming error");
        }
      },
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

  const mainRef = useRef<HTMLDivElement>(null);
  const leftColRef = useRef<HTMLDivElement>(null);

  // Desktop layout sizing state
  const [leftW, setLeftW] = useState<number | null>(null);
  const [inputH, setInputH] = useState<number | null>(null);
  const [stateW, setStateW] = useState<number | null>(null);

  // Desktop idle collapse: empty Variables + Flow Graph panels merge into a
  // single collapsed affordance (one CTA, no near-duplicate placeholders) so
  // the I/O tray below the editor can grow into the freed vertical space.
  // Mobile keeps its tabbed panels untouched.
  const desktopIdle =
    !isMobile && status === "idle" && trace.length === 0 && cfgNodeCount === 0;
  const trayH = inputH ?? (desktopIdle ? 400 : 260);

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
      const cur = prev ?? 260;
      const max = colH - MIN_EDITOR_H;
      return Math.min(Math.max(cur - dy, MIN_INPUT_H), Math.max(max, MIN_INPUT_H));
    });
  };

  const dragState = (dx: number) => {
    setStateW((prev) => {
      const cur = prev ?? 280;
      const rightW = mainW() - (leftColRef.current?.clientWidth || 0);
      const dynamicMax = Math.max(650, window.innerWidth * 0.48);
      const max = Math.min(dynamicMax, rightW - MIN_CFG_W - 8);
      return Math.min(Math.max(cur - dx, MIN_STATE_W), Math.max(max, MIN_STATE_W));
    });
  };

  return (
    <div
      className="flex flex-col h-screen h-dvh bg-viz-body text-viz-ink select-none font-sans"
      data-engine={engineSel.engine}
      data-fallback={engineSel.fallback}
      data-toolchain={engineSel.toolchainNote}
    >
      {/* Header */}
      <Header
        theme={theme}
        onThemeChange={(t) => setTheme(applyTheme(t))}
        onExecute={handleExecute}
        isLoading={isLoading}
        engineSel={engineSel}
      />

      {/* Mobile Segmented View Switcher (< 768px) */}
      {isMobile && (
        <nav
          aria-label="Mobile panel switcher"
          className="flex items-center justify-around bg-viz-panel/80 border-b border-viz-line p-1 shrink-0 z-20"
        >
          <button
            onClick={() => setMobileTab("code")}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-xs font-medium transition-colors ${
              mobileTab === "code"
                ? "bg-viz-body text-amber-400 shadow-xs"
                : "text-viz-ink/60 hover:text-viz-ink"
            }`}
          >
            <Code2 className="w-3.5 h-3.5" />
            <span>Code</span>
          </button>
          <button
            onClick={() => setMobileTab("flow")}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-xs font-medium transition-colors ${
              mobileTab === "flow"
                ? "bg-viz-body text-amber-400 shadow-xs"
                : "text-viz-ink/60 hover:text-viz-ink"
            }`}
          >
            <GitFork className="w-3.5 h-3.5" />
            <span>Flow Graph</span>
          </button>
          <button
            onClick={() => setMobileTab("state")}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-xs font-medium transition-colors ${
              mobileTab === "state"
                ? "bg-viz-body text-amber-400 shadow-xs"
                : "text-viz-ink/60 hover:text-viz-ink"
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Variables</span>
          </button>
          <button
            onClick={() => setMobileTab("console")}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-xs font-medium transition-colors relative ${
              mobileTab === "console"
                ? "bg-viz-body text-amber-400 shadow-xs"
                : "text-viz-ink/60 hover:text-viz-ink"
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>I/O</span>
            {showIoDot && mobileTab !== "console" && (
              <span
                aria-label="New run output"
                title="Run finished — new output"
                className="w-2 h-2 rounded-full bg-amber-400"
              />
            )}
          </button>
        </nav>
      )}

      {/* Main Content Area */}
      <div ref={mainRef} className="flex flex-1 min-h-0 overflow-hidden relative">
        {/* Mobile View: All components stay mounted in DOM to prevent state/zoom reset */}
        {isMobile ? (
          <div className="flex flex-1 min-h-0 overflow-hidden relative w-full h-full">
            <div
              className={`flex-1 flex flex-col h-full overflow-hidden ${
                mobileTab === "code" ? "flex" : "hidden"
              }`}
            >
              <Suspense fallback={<EditorSkeleton />}>
                <CodeEditor />
              </Suspense>
            </div>

            <div
              className={`flex-1 flex flex-col h-full overflow-hidden ${
                mobileTab === "flow" ? "flex" : "hidden"
              }`}
            >
              <Suspense fallback={<CfgSkeleton />}>
                <TraceFlow />
              </Suspense>
            </div>

            <div
              className={`flex-1 flex flex-col h-full overflow-y-auto ${
                mobileTab === "state" ? "flex" : "hidden"
              }`}
            >
              <Suspense fallback={<StatePanelSkeleton />}>
                <StatePanel />
              </Suspense>
            </div>

            <div
              className={`flex-1 flex flex-col h-full overflow-hidden ${
                mobileTab === "console" ? "flex" : "hidden"
              }`}
            >
              <WorkbenchTray />
            </div>
          </div>
        ) : (
          /* Desktop Workbench: 3-column resizable layout (idle collapses the
             empty Flow + Variables panes into one affordance with a single
             CTA; the per-panel placeholders stay mounted on mobile only) */
          <div className="flex flex-1 min-h-0 overflow-hidden w-full h-full">
            {/* Left Panel: Editor + Tabbed Workbench Tray */}
            <div
              ref={leftColRef}
              className="flex flex-col shrink-0 min-w-0 overflow-hidden"
              style={{ width: leftW ?? "42%" }}
            >
              <div className="flex-1 min-h-0 overflow-hidden at-reserve-editor">
                <Suspense fallback={<EditorSkeleton />}>
                  <CodeEditor />
                </Suspense>
              </div>

              <Splitter
                direction="horizontal"
                onDrag={dragInput}
                label="Resize input area"
              />

              <div
                className="flex flex-col shrink-0 overflow-hidden border-t border-viz-line"
                style={{ height: trayH }}
              >
              <WorkbenchTray segmented />
              </div>
            </div>

            {desktopIdle ? (
              <div
                data-testid="idle-trace-affordance"
                className="flex-1 min-w-0 flex flex-col items-center justify-center gap-3 bg-viz-body border-l border-viz-line px-6 text-center"
              >
                <button
                  onClick={handleExecute}
                  aria-label="Run program to see execution trace"
                  className="text-sm text-amber-400 hover:text-amber-300 font-medium transition-colors"
                >
                  Run to see execution trace <span aria-hidden="true">→</span>
                </button>
                <Link
                  to="/algorithms"
                  className="text-xs text-viz-ink/50 hover:text-viz-ink transition-colors"
                >
                  Browse the Algorithms guide <span aria-hidden="true">→</span>
                </Link>
              </div>
            ) : (
            <>
            <Splitter
              direction="vertical"
              onDrag={dragLeft}
              label="Resize editor area"
            />

            {/* Middle Panel: CFG (TraceFlow) */}
            <div className="flex-1 min-w-0 overflow-hidden at-reserve-cfg relative">
              <Suspense fallback={<CfgSkeleton />}>
                <TraceFlow />
              </Suspense>
            </div>

            <Splitter
              direction="vertical"
              onDrag={dragState}
              label="Resize state panel"
            />

            {/* Right Panel: Variable State Inspector */}
            <div
              className="shrink-0 overflow-hidden border-l border-viz-line at-reserve-state"
              style={{ width: stateW ?? 280 }}
            >
              <Suspense fallback={<StatePanelSkeleton />}>
                <StatePanel />
              </Suspense>
            </div>
            </>
            )}
          </div>
        )}
      </div>

      {/* Error / Runtime Error Banner */}
      {(errorMessage || compileError || runtimeError) && (
        <div className="relative px-4 py-2.5 pr-12 bg-red-950/70 border-t border-red-800/80 text-xs text-red-200 font-mono whitespace-pre-wrap max-h-36 overflow-y-auto shrink-0 shadow-lg">
          <button
            onClick={() => useUIStore.getState().clearError()}
            aria-label="Dismiss error"
            className="absolute top-1 right-1 flex items-center justify-center w-10 h-10 min-w-[40px] min-h-[40px] text-red-400 hover:text-red-200 transition-colors"
          >
            ✕
          </button>
          <div className="font-semibold text-red-400 mb-0.5">Execution Error:</div>
          {compileError || runtimeError || errorMessage}
        </div>
      )}

      {/* Non-fatal warnings (e.g. skipped template bodies) — run succeeded */}
      {warnings.length > 0 && status === "done" && (
        <div className="relative px-4 py-2.5 pr-12 bg-amber-950/70 border-t border-amber-800/80 text-xs text-amber-200 font-mono whitespace-pre-wrap max-h-36 overflow-y-auto shrink-0 shadow-lg">
          <button
            onClick={() => useUIStore.getState().clearError()}
            aria-label="Dismiss warning"
            className="absolute top-1 right-1 flex items-center justify-center w-10 h-10 min-w-[40px] min-h-[40px] text-amber-400 hover:text-amber-200 transition-colors"
          >
            ✕
          </button>
          <div className="font-semibold text-amber-400 mb-0.5">Warning:</div>
          {warnings.join("\n")}
        </div>
      )}

      {/* Stdout status link (retired when per-step stdout present) */}
      {hasPerStepStdout ? (
        <ProgramOutputBox variant="status" />
      ) : (
        stdout &&
        status === "done" &&
        !isMobile && (
          <div className="px-4 py-2 bg-viz-body border-t border-viz-line text-xs text-viz-ink font-mono shrink-0">
            <span className="text-viz-ink/60 mr-2">stdout:</span>
            {stdout.trim()}
          </div>
        )
      )}

      {/* Trace Scrubber (Timeline & Playback Controls) */}
      <div className="at-reserve-scrubber shrink-0">
        <TraceScrubber />
      </div>

      {/* Persistent Legal Footer */}
      <Footer />
    </div>
  );
}
