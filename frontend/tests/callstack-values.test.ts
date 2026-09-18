/**
 * tests/callstack-values.test.ts — CallStackView values + live line (todo 9).
 *
 * Run (no new deps — repo has no vitest; esbuild ships inside vite):
 *   node node_modules/esbuild/bin/esbuild tests/callstack-values.test.ts --bundle \
 *     --platform=node --format=cjs --jsx=automatic --loader:.css=empty \
 *     --define:import.meta.env='{}' \
 *     --outfile=/tmp/callstack-values.test.cjs --log-level=error \
 *   && node --test /tmp/callstack-values.test.cjs
 * (format MUST be cjs: react-dom/server does require("util") internally,
 * which an esm bundle cannot satisfy — "Dynamic require not supported".)
 *
 * RED on pre-todo-9 tree: footer chips are name-only (`x`, never `x=3`)
 * and the top frame shows the enter-time line (:5) instead of the live
 * step line (:10) — the live position is already selectable via
 * `currentEvent.line`, so no store change is needed.
 *
 * GREEN: chips carry truncated values (`x=3`); top-frame line tracks the
 * scrubber (step2 → :10, step3 → :12); deep stacks still clip-scroll
 * (max-h-120 policy untouched); empty-vars frames render cleanly; long
 * values truncate with the full value on title (renderCellValue, the same
 * helper VariableRow's fallback uses — not a copy).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CallStackFrames } from "../src/components/StatePanel/CallStackView";
import { useTraceStore } from "../src/store/traceStore";
import { renderCellValue } from "../src/utils/format";
import type { TraceEvent } from "../src/types/trace";

const LONG = "abcdefghijklmnopqrstuvwxyz0123456789";

/** Nested trace: main calls f(x=3); f advances 10 → 12 with x=4. */
function nestedTrace(): TraceEvent[] {
  return [
    { type: "enter", func: "main", depth: 0, line: 1, params: {} },
    { type: "enter", func: "f", depth: 1, line: 5, params: { x: 3 } },
    { type: "state", func: "f", depth: 1, line: 10, vars: { x: 3, s: LONG } },
    { type: "state", func: "f", depth: 1, line: 12, vars: { x: 4, s: LONG } },
  ];
}

/** Position the real store (loadTrace + setStep keeps callStack honest). */
function renderAt(trace: TraceEvent[], step: number): string {
  useTraceStore.getState().loadTrace(trace);
  useTraceStore.getState().setStep(step);
  const { trace: t, currentStep: s, callStack: cs } = useTraceStore.getState();
  // CallStackFrames is the store-free presentational half of CallStackView:
  // renderToStaticMarkup sees the server snapshot (empty store), so the
  // subscribed wrapper cannot be asserted here — inputs above come from the
  // real store transitions, keeping callStack/frameVars honest.
  return renderToStaticMarkup(
    React.createElement(CallStackFrames, { trace: t, currentStep: s, callStack: cs }),
  );
}

describe("callstack value chips", () => {
  it("footer chips carry values (f(x=3)-style)", () => {
    const html = renderAt(nestedTrace(), 2);
    assert.match(html, /x=3/);
  });

  it("chips truncate with the VariableRow helper", () => {
    const html = renderAt(nestedTrace(), 2);
    const expected = `s=${renderCellValue(LONG)}`;
    assert.ok(renderCellValue(LONG).includes("…"));
    assert.match(html, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });

  it("full long value is on title/hover", () => {
    const html = renderAt(nestedTrace(), 2);
    assert.match(html, new RegExp(`title="${LONG}"`));
  });

  it("frames with empty vars render a clean chips row (no crash)", () => {
    const html = renderAt(
      [
        { type: "enter", func: "main", depth: 0, line: 1, params: {} },
        { type: "enter", func: "g", depth: 1, line: 7, params: {} },
      ],
      1,
    );
    assert.match(html, /g\(\)/);
    assert.doesNotMatch(html, />([A-Za-z_][A-Za-z0-9_]*)=/);
  });
});

describe("callstack live line", () => {
  it("top frame shows the live step line, not enter-time", () => {
    const html = renderAt(nestedTrace(), 2);
    assert.match(html, /:10/);
    assert.doesNotMatch(html, /:5/);
  });

  it("line tracks the scrubber across steps", () => {
    assert.match(renderAt(nestedTrace(), 2), /:10/);
    const html = renderAt(nestedTrace(), 3);
    assert.match(html, /:12/);
    assert.match(html, /x=4/);
  });
});

describe("callstack height policy", () => {
  it("deep stacks still clip-scroll (max-h policy unchanged)", () => {
    const html = renderAt(nestedTrace(), 2);
    assert.match(html, /max-h-/);
  });
});
