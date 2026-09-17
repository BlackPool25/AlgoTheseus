/**
 * components/Editor/CodeEditor.tsx — Monaco editor wrapper.
 *
 * Highlights the current trace line with a yellow gutter marker.
 * Shows compile errors as Monaco markers (red squiggles + gutter icons).
 * Reads code from uiStore, writes back on change.
 */

import Editor, { type Monaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { useEffect, useRef, useState } from "react";
import { useTraceStore } from "../../store/traceStore";
import { useUIStore } from "../../store/uiStore";
import { currentTheme, monacoThemeFor } from "../../theme";
import type { TraceEvent } from "../../types/trace";

interface GutterLines {
  prev: number | null;
  next: number;
}

function resolveGutterLines(
  trace: TraceEvent[],
  currentStep: number,
  currentEvent: TraceEvent | null,
): GutterLines | null {
  if (!currentEvent) return null;
  let next = currentEvent.line;
  if (currentEvent.type === "exit" && currentEvent.return_line != null) {
    next = currentEvent.return_line;
  }
  let prev: number | null = null;
  if (currentEvent.type === "state" && currentEvent.prev_line != null) {
    prev = currentEvent.prev_line;
  } else if (currentStep > 0 && currentStep <= trace.length) {
    prev = trace[currentStep - 1]?.line ?? null;
  }
  return { prev, next };
}

/** Parse g++ error output into Monaco markers.
 *
 * g++ error format: "prog.cpp:12:5: error: ..."
 * We extract line/col and message.
 */
function parseCompileErrors(
  compileError: string,
  monaco: Monaco
): editor.IMarkerData[] {
  const markers: editor.IMarkerData[] = [];
  const lines = compileError.split("\n");

  for (const line of lines) {
    // Match: filename:line:col: severity: message
    const m = line.match(/^[^:]+:(\d+):(\d+):\s*(error|warning|note):\s*(.+)$/);
    if (m) {
      const lineNum = parseInt(m[1], 10);
      const col = parseInt(m[2], 10);
      const severity = m[3];
      const message = m[4];

      markers.push({
        startLineNumber: lineNum,
        startColumn: col,
        endLineNumber: lineNum,
        endColumn: col + 1,
        message,
        severity:
          severity === "error"
            ? monaco.MarkerSeverity.Error
            : severity === "warning"
            ? monaco.MarkerSeverity.Warning
            : monaco.MarkerSeverity.Info,
        source: "g++",
      });
    }
  }

  return markers;
}

export function CodeEditor() {
  const code = useUIStore((s) => s.code);
  const setCode = useUIStore((s) => s.setCode);
  const compileError = useUIStore((s) => s.compileError);
  const runtimeError = useUIStore((s) => s.runtimeError);
  const currentEvent = useTraceStore((s) => s.currentEvent);
  const trace = useTraceStore((s) => s.trace);
  const currentStep = useTraceStore((s) => s.currentStep);

  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const decorationsRef = useRef<editor.IEditorDecorationsCollection | null>(null);

  const [monacoTheme, setMonacoTheme] = useState(() =>
    monacoThemeFor(currentTheme()),
  );
  useEffect(() => {
    const observer = new MutationObserver(() =>
      setMonacoTheme(monacoThemeFor(currentTheme())),
    );
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  // Two-arrow gutter: executed line (prev) vs next-to-execute line (current).
  // prev_line wins; else the previous step's line. Exit events map to their
  // return_line (call site); otherwise the current event's line is next.
  const gutter = resolveGutterLines(trace, currentStep, currentEvent);
  // v1 traces carry no prev_line/return_line: keep the legacy single highlight.
  const twoArrow =
    gutter != null &&
    trace.some(
      (e) =>
        (e.type === "state" && e.prev_line != null) ||
        (e.type === "exit" && e.return_line != null),
    );

  // Highlight the current + previous trace lines
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;

    if (decorationsRef.current) {
      decorationsRef.current.clear();
    }

    if (currentEvent && gutter) {
      if (!twoArrow) {
        decorationsRef.current = ed.createDecorationsCollection([
          {
            range: {
              startLineNumber: gutter.next,
              startColumn: 1,
              endLineNumber: gutter.next,
              endColumn: 1,
            },
            options: {
              isWholeLine: true,
              className: "current-line-highlight",
              glyphMarginClassName: "current-line-glyph",
            },
          },
        ]);
        ed.revealLineInCenterIfOutsideViewport(gutter.next);
        return;
      }
      const decorations: editor.IModelDeltaDecoration[] = [];
      if (gutter.prev != null && gutter.prev !== gutter.next) {
        decorations.push({
          range: {
            startLineNumber: gutter.prev,
            startColumn: 1,
            endLineNumber: gutter.prev,
            endColumn: 1,
          },
          options: {
            isWholeLine: true,
            className: "gutter-prev-line",
            glyphMarginClassName: "gutter-prev-glyph",
          },
        });
      }
      decorations.push({
        range: {
          startLineNumber: gutter.next,
          startColumn: 1,
          endLineNumber: gutter.next,
          endColumn: 1,
        },
        options: {
          isWholeLine: true,
          className: runtimeError
            ? "gutter-next-line gutter-exception-line"
            : "gutter-next-line",
          glyphMarginClassName: "gutter-next-glyph",
        },
      });
      decorationsRef.current = ed.createDecorationsCollection(decorations);
      ed.revealLineInCenterIfOutsideViewport(gutter.next);
    }
  }, [currentEvent, gutter, twoArrow, runtimeError]);

  // Show compile error markers
  useEffect(() => {
    const ed = editorRef.current;
    const monaco = monacoRef.current;
    if (!ed || !monaco) return;

    const model = ed.getModel();
    if (!model) return;

    if (compileError) {
      const markers = parseCompileErrors(compileError, monaco);
      monaco.editor.setModelMarkers(model, "compile", markers);

      // Scroll to first error
      if (markers.length > 0) {
        ed.revealLineInCenterIfOutsideViewport(markers[0].startLineNumber);
      }
    } else {
      // Clear markers when no error
      monaco.editor.setModelMarkers(model, "compile", []);
    }
  }, [compileError]);

  function handleMount(ed: editor.IStandaloneCodeEditor, monaco: Monaco) {
    editorRef.current = ed;
    monacoRef.current = monaco;
  }

  return (
    <div className="relative h-full">
      <Editor
        height="100%"
        language="cpp"
        theme={monacoTheme}
        value={code}
        onChange={(v) => setCode(v ?? "")}
        onMount={handleMount}
        options={{
          automaticLayout: true,
          fontSize: 13,
          minimap: { enabled: false },
          scrollBeyondLastLine: true,
          glyphMargin: true,
          lineNumbers: "on",
          wordWrap: "on",
          wrappingIndent: "deepIndent",
          wrappingStrategy: "advanced",
          scrollbar: {
            horizontal: "visible",
            vertical: "visible",
            horizontalScrollbarSize: 6,
            verticalScrollbarSize: 8,
            useShadows: false,
          },
          stickyScroll: { enabled: false },
          renderWhitespace: "none",
          smoothScrolling: true,
        }}
      />
      {gutter && twoArrow && (
        <div className="absolute bottom-2 right-2 flex items-center gap-1 z-10 opacity-70">
          {gutter.prev != null && gutter.prev !== gutter.next && (
            <span data-testid="gutter-prev" className="gutter-prev-chip text-[10px] font-normal">
              ◀ line {gutter.prev}
            </span>
          )}
          <span data-testid="gutter-next" className="gutter-next-chip text-[10px] font-normal">
            ▶ line {gutter.next}
          </span>
        </div>
      )}
    </div>
  );
}
