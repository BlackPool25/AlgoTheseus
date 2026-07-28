/**
 * components/Editor/CodeEditor.tsx — Monaco editor wrapper.
 *
 * Highlights the current trace line with a yellow gutter marker.
 * Shows compile errors as Monaco markers (red squiggles + gutter icons).
 * Reads code from uiStore, writes back on change.
 */

import Editor, { type Monaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { useEffect, useRef } from "react";
import { useTraceStore } from "../../store/traceStore";
import { useUIStore } from "../../store/uiStore";

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
  const currentEvent = useTraceStore((s) => s.currentEvent);

  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const decorationsRef = useRef<editor.IEditorDecorationsCollection | null>(null);

  // Highlight the current trace line
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;

    if (decorationsRef.current) {
      decorationsRef.current.clear();
    }

    if (currentEvent) {
      decorationsRef.current = ed.createDecorationsCollection([
        {
          range: {
            startLineNumber: currentEvent.line,
            startColumn: 1,
            endLineNumber: currentEvent.line,
            endColumn: 1,
          },
          options: {
            isWholeLine: true,
            className: "current-line-highlight",
            glyphMarginClassName: "current-line-glyph",
          },
        },
      ]);
      ed.revealLineInCenterIfOutsideViewport(currentEvent.line);
    }
  }, [currentEvent]);

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
    <Editor
      height="100%"
      language="cpp"
      theme="vs-dark"
      value={code}
      onChange={(v) => setCode(v ?? "")}
      onMount={handleMount}
      options={{
        fontSize: 13,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        glyphMargin: true,
        lineNumbers: "on",
        wordWrap: "on",
      }}
    />
  );
}
