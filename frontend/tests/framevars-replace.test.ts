/**
 * tests/framevars-replace.test.ts — Task 11 replace-vs-merge in frameVars.
 *
 * Run: npx tsc tests/framevars-replace.test.ts
 *   src/components/StatePanel/frameVars.ts src/types/trace.ts
 *   --outDir /tmp/fvtest --module commonjs --target es2022
 *   --moduleResolution node --skipLibCheck --strict --esModuleInterop \
 *   && node --test /tmp/fvtest/tests/framevars-replace.test.js
 *
 * Pure-logic module (imports only the TraceEvent type, erased at compile),
 * so the plain tsc+node pattern (scopeDisplay.test.ts precedent) is used —
 * no esbuild bundling needed.
 *
 * RED-first: on HEAD buildFramesWithVars merges ({...old,...vars}), so a
 * var dropped from later snapshots (tmp) still haunts caller tables.
 *
 * GREEN: each state event's vars ARE the in-scope set (parser
 * frames_at_step precedent: stack[-1].vars = dict(event.vars)); names
 * absent from the event are dropped. Var-less probes (vars={}) carry no
 * scope info and keep the frame. Enter params still seed frames.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildFramesWithVars,
  type StackFrameInfo,
} from "../src/components/StatePanel/frameVars";
import type { TraceEvent } from "../src/types/trace";

// main(n=3): tmp=99 live at step 1, dropped at step 2, probe {} at step 3,
// re-added as tmp=7 at step 4.
const TRACE_DROP: TraceEvent[] = [
  { type: "enter", line: 1, func: "main", depth: 0, params: { n: 3 } },
  { type: "state", line: 2, func: "main", depth: 0, vars: { n: 3, i: 0, tmp: 99 } },
  { type: "state", line: 3, func: "main", depth: 0, vars: { n: 3, i: 1 } },
  { type: "state", line: 4, func: "main", depth: 0, vars: {} },
  { type: "state", line: 5, func: "main", depth: 0, vars: { n: 3, i: 2, tmp: 7 } },
];

// Nested: helper(a=10) runs under main(x=1); tmp lives only at step 2.
const TRACE_NESTED: TraceEvent[] = [
  { type: "enter", line: 1, func: "main", depth: 0, params: { x: 1 } },
  { type: "enter", line: 2, func: "helper", depth: 1, params: { a: 10 } },
  { type: "state", line: 3, func: "helper", depth: 1, vars: { a: 10, tmp: 5 } },
  { type: "state", line: 4, func: "helper", depth: 1, vars: { a: 11 } },
];

const MAIN: StackFrameInfo[] = [{ func: "main", depth: 0, line: 5 }];
const BOTH: StackFrameInfo[] = [
  { func: "main", depth: 0, line: 1 },
  { func: "helper", depth: 1, line: 4 },
];

function varsOf(
  trace: TraceEvent[],
  step: number,
  stack: StackFrameInfo[],
  func: string,
  depth: number,
): Record<string, unknown> {
  const frames = buildFramesWithVars(trace, step, stack);
  const found = frames.find((f) => f.func === func && f.depth === depth);
  assert.ok(found, `frame ${func}@${depth} present`);
  return found.vars as Record<string, unknown>;
}

describe("framevars replace-vs-merge", () => {
  it("enter params seed frames before any state event", () => {
    assert.deepEqual(varsOf(TRACE_DROP, 0, MAIN, "main", 0), { n: 3 });
  });

  it("dropped var vanishes from the table (not merged forward)", () => {
    assert.deepEqual(varsOf(TRACE_DROP, 2, MAIN, "main", 0), { n: 3, i: 1 });
  });

  it("empty-vars probe does not wipe seeded/in-scope vars", () => {
    assert.deepEqual(varsOf(TRACE_DROP, 3, MAIN, "main", 0), { n: 3, i: 1 });
  });

  it("dropped-then-readded var shows the latest value", () => {
    assert.deepEqual(varsOf(TRACE_DROP, 4, MAIN, "main", 0), {
      n: 3,
      i: 2,
      tmp: 7,
    });
  });

  it("current frame matches the live snapshot exactly", () => {
    // Current-frame view must be unchanged: exactly the latest snapshot.
    assert.deepEqual(varsOf(TRACE_DROP, 1, MAIN, "main", 0), {
      n: 3,
      i: 0,
      tmp: 99,
    });
  });

  it("caller frame keeps its own vars while child drops a var", () => {
    assert.deepEqual(varsOf(TRACE_NESTED, 3, BOTH, "main", 0), { x: 1 });
    assert.deepEqual(varsOf(TRACE_NESTED, 3, BOTH, "helper", 1), { a: 11 });
  });
});
