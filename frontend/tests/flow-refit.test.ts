/**
 * tests/flow-refit.test.ts — CFG flowchart auto-refit decision lock.
 *
 * Run (same convention as tree-overlap.test.ts — no vitest in repo,
 * esbuild ships inside vite; run from frontend/):
 *   node node_modules/esbuild/bin/esbuild tests/flow-refit.test.ts --bundle \
 *     --platform=node --format=cjs --jsx=automatic --loader:.css=empty \
 *     --define:import.meta.env='{}' \
 *     --outfile=/tmp/flow-refit.test.cjs --log-level=error \
 *   && node --test /tmp/flow-refit.test.cjs
 *
 * RED on pre-fix TraceFlow: fitView ran once per CFG load, so panel/window
 * resizes left the graph stuck at the old zoom/pan, and expanding a loop
 * node never re-fit (store cfgNodes.length is unchanged by expand/collapse).
 *
 * GREEN: shouldAutoRefit() re-fits on container resize unless the user
 * manually moved the view, ignores zero-size/hidden containers and
 * no-change observations; visibleFitKey() changes when expand/collapse
 * alters the watched dep input.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FLOW_FIT_PADDING,
  FLOW_REFIT_DEBOUNCE_MS,
  shouldAutoRefit,
  visibleFitKey,
  type AutoRefitInput,
} from "../src/utils/flowViewport";

function input(over: Partial<AutoRefitInput>): AutoRefitInput {
  return {
    userMoved: false,
    width: 800,
    height: 600,
    prevWidth: 640,
    prevHeight: 600,
    ...over,
  };
}

describe("shouldAutoRefit — container resize policy", () => {
  it("resize + untouched viewport => true (panel drag re-fits)", () => {
    assert.equal(shouldAutoRefit(input({})), true);
  });

  it("height-only change + untouched => true", () => {
    assert.equal(
      shouldAutoRefit(input({ width: 800, prevWidth: 800, height: 500, prevHeight: 600 })),
      true,
    );
  });

  it("resize + userMoved => false (never steal the camera back)", () => {
    assert.equal(shouldAutoRefit(input({ userMoved: true })), false);
  });

  it("zero-size container => false (hidden mobile tab must not fitView)", () => {
    assert.equal(shouldAutoRefit(input({ width: 0, height: 600 })), false);
    assert.equal(shouldAutoRefit(input({ width: 800, height: 0 })), false);
    assert.equal(shouldAutoRefit(input({ width: 0, height: 0 })), false);
  });

  it("no size change => false (observer fires for non-resize reasons too)", () => {
    assert.equal(
      shouldAutoRefit(input({ width: 800, prevWidth: 800, height: 600, prevHeight: 600 })),
      false,
    );
  });

  it("first observation after fresh CFG load => false (baseline, no prev delta)", () => {
    // Component seeds prev := current, so widths/heights match.
    assert.equal(
      shouldAutoRefit(input({ width: 800, prevWidth: 800, height: 600, prevHeight: 600 })),
      false,
    );
  });

  it("hidden tab becoming visible (0 -> N) + untouched => true", () => {
    assert.equal(
      shouldAutoRefit(input({ width: 800, prevWidth: 0, height: 600, prevHeight: 0 })),
      true,
    );
  });

  it("userMoved wins even when the size genuinely changed", () => {
    assert.equal(
      shouldAutoRefit(input({ userMoved: true, width: 1024, prevWidth: 640 })),
      false,
    );
  });
});

describe("visibleFitKey — expand/collapse dep input", () => {
  it("same visible + expanded counts => same key (no spurious refit)", () => {
    assert.equal(visibleFitKey(7, 1), visibleFitKey(7, 1));
  });

  it("revealed nodes change the key (expand re-fits despite same store length)", () => {
    // Collapsed loop hides children: 5 visible; expanded: 8 visible.
    assert.notEqual(visibleFitKey(5, 0), visibleFitKey(8, 1));
  });

  it("expanded-set toggle alone changes the key (collapse of childless loop)", () => {
    assert.notEqual(visibleFitKey(5, 0), visibleFitKey(5, 1));
  });
});

describe("refit constants — debounce + padding contract", () => {
  it("debounce is ~150ms so panel-drag bursts coalesce", () => {
    assert.equal(FLOW_REFIT_DEBOUNCE_MS, 150);
  });

  it("auto-fit padding matches the initial fit (0.2)", () => {
    assert.equal(FLOW_FIT_PADDING, 0.2);
  });
});
