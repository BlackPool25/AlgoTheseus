/**
 * tests/scrubberGroups.test.ts — T14 grouped-scrubber boundary landing locks.
 *
 * Run: npx tsc tests/scrubberGroups.test.ts src/store/traceStore.ts
 *   src/utils/scopeDisplay.ts src/types/trace.ts
 *   --outDir .tmp-scrubtest --module commonjs --target es2022
 *   --moduleResolution node --skipLibCheck --strict \
 *   && node --test .tmp-scrubtest/tests/scrubberGroups.test.js; rm -rf .tmp-scrubtest
 *
 * Contract under test (see traceStore `next`/`prev` docs for the chosen
 * alternative — enter-at-near-edge, second press exits, symmetric both ways):
 * next/prev land on collapsed-group boundaries with "N identical steps"
 * affordance data (startStep/endStep/count) surfaced for the current step;
 * expanding (or slider/setStep) reaches EVERY raw index (R7 100%
 * reachability); carried steps group by filled identity without merging
 * across a live mutation.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { useTraceStore } from "../src/store/traceStore";
import type { TraceEvent } from "../src/types/trace";

function load(trace: TraceEvent[]): void {
  const st = useTraceStore.getState();
  st.reset();
  st.loadTrace(trace);
}

function cur(): number {
  return useTraceStore.getState().currentStep;
}

function step(): void {
  useTraceStore.getState().next();
}

function back(): void {
  useTraceStore.getState().prev();
}

/** Group containing `step` (mirrors TraceScrubber's collapsed lookup). */
function groupAt(step: number): { startStep: number; endStep: number; count: number } | null {
  const { compressedSteps, expandedGroups } = useTraceStore.getState();
  for (const g of compressedSteps) {
    if (step >= g.startStep && step <= g.endStep && !expandedGroups.includes(g.startStep)) {
      return g;
    }
  }
  return null;
}

/** enter + 5 identical states + exit — mirrors createCompressedNDJSON(5). */
const IDENTICAL_5: TraceEvent[] = [
  { type: "enter", line: 1, func: "main", depth: 1, params: {} },
  ...[1, 2, 3, 4, 5].map(
    (): TraceEvent => ({
      type: "state",
      line: 2,
      func: "main",
      depth: 1,
      vars: { x: 42, y: "hello" },
    }),
  ),
  { type: "exit", line: 3, func: "main", depth: 1, return_val: 0 },
];

/** Loop-heavy: held vars across iters, one live mutation, then held again. */
const CARRIED_LOOP: TraceEvent[] = [
  { type: "enter", line: 1, func: "main", depth: 1, params: {} },
  { type: "state", line: 2, func: "main", depth: 1, vars: { i: 0 } },
  { type: "iter", line: 2, func: "main", depth: 1, iteration: 1 },
  { type: "state", line: 2, func: "main", depth: 1, vars: { i: 0 } },
  { type: "iter", line: 2, func: "main", depth: 1, iteration: 2 },
  { type: "state", line: 2, func: "main", depth: 1, vars: { i: 1 } },
  { type: "iter", line: 2, func: "main", depth: 1, iteration: 3 },
  { type: "exit", line: 3, func: "main", depth: 1, return_val: 0 },
];

describe("T14 boundary landing (identical-states group)", () => {
  it("next from before a group lands ON its start; second next exits past its end", () => {
    load(IDENTICAL_5);
    assert.equal(cur(), 0);
    step();
    assert.equal(cur(), 1); // group {1..5} start boundary, not skipped past
    step();
    assert.equal(cur(), 6); // second press traverses past the group
  });

  it("prev from after a group lands ON its end; second prev exits before its start", () => {
    load(IDENTICAL_5);
    useTraceStore.getState().setStep(6);
    back();
    assert.equal(cur(), 5); // group end boundary
    back();
    assert.equal(cur(), 0); // before the group
  });

  it("affordance data (span + count) is surfaced for the current step", () => {
    load(IDENTICAL_5);
    step(); // land on boundary
    const g = groupAt(cur());
    assert.ok(g !== null, "boundary step must sit inside a collapsed group");
    assert.deepEqual(g, { startStep: 1, endStep: 5, count: 5 });
  });
});

describe("T14 no-skip audit", () => {
  it("collapsed next-walk stops at a boundary first — interior never skipped silently", () => {
    load(IDENTICAL_5);
    const seen: number[] = [cur()];
    while (cur() < IDENTICAL_5.length - 1) {
      step();
      seen.push(cur());
    }
    // First press from outside lands on the start boundary (affordance seen
    // before anything is passed over); the walk terminates at the last step.
    assert.equal(seen[1], 1);
    assert.equal(seen[seen.length - 1], IDENTICAL_5.length - 1);
    for (let k = 1; k < seen.length; k++) {
      assert.ok(seen[k] > seen[k - 1], "walk must always move forward");
    }
  });

  it("expanded next-walk + setStep reach EVERY raw index (R7 100% reachability)", () => {
    for (const trace of [IDENTICAL_5, CARRIED_LOOP]) {
      load(trace);
      for (const g of useTraceStore.getState().compressedSteps) {
        useTraceStore.getState().toggleExpand(g.startStep);
      }
      const seen: number[] = [cur()];
      while (cur() < trace.length - 1) {
        step();
        seen.push(cur());
      }
      assert.deepEqual(seen, trace.map((_, i) => i));
      // Slider/random-jump path reaches each index with the right event.
      for (let i = 0; i < trace.length; i++) {
        useTraceStore.getState().setStep(i);
        const st = useTraceStore.getState();
        assert.equal(st.currentStep, i);
        assert.equal(st.currentEvent, trace[i]);
      }
    }
  });
});

describe("T14 carried steps group by filled identity", () => {
  it("state/iter run with held vars collapses; live mutation breaks the run", () => {
    load(CARRIED_LOOP);
    assert.deepEqual(useTraceStore.getState().compressedSteps, [
      { startStep: 1, endStep: 4, count: 4 },
      { startStep: 5, endStep: 6, count: 2 },
    ]);
  });

  it("distinct branch outcomes never merge", () => {
    load([
      { type: "enter", line: 1, func: "main", depth: 1, params: {} },
      { type: "state", line: 2, func: "main", depth: 1, vars: { a: 1 } },
      { type: "branch", line: 3, func: "main", depth: 1, condition: "a > 0", taken: true },
      { type: "branch", line: 3, func: "main", depth: 1, condition: "a > 0", taken: false },
      { type: "state", line: 4, func: "main", depth: 1, vars: { a: 1 } },
    ]);
    assert.deepEqual(useTraceStore.getState().compressedSteps, []);
  });

  it("identical vars with growing stdout never merge (T10 guard holds)", () => {
    load([
      { type: "enter", line: 1, func: "main", depth: 1, params: {} },
      { type: "state", line: 2, func: "main", depth: 1, vars: { limit: 3 }, stdout: "1\n" },
      { type: "state", line: 3, func: "main", depth: 1, vars: { limit: 3 }, stdout: "1\n2\n" },
      { type: "state", line: 3, func: "main", depth: 1, vars: { limit: 3 }, stdout: "1\n2\n3\n" },
      { type: "exit", line: 4, func: "main", depth: 1, return_val: 0 },
    ]);
    assert.deepEqual(useTraceStore.getState().compressedSteps, []);
  });
});
