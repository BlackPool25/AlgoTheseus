/**
 * tests/deque.test.ts — deque kind end to end (todo 4).
 *
 * Run (no new deps — repo has no vitest; esbuild ships inside vite):
 *   node node_modules/esbuild/bin/esbuild tests/deque.test.ts --bundle \
 *     --platform=node --format=cjs --jsx=automatic --loader:.css=empty \
 *     --define:import.meta.env='{}' \
 *     --outfile=/tmp/deque.test.cjs --log-level=error \
 *   && node --test /tmp/deque.test.cjs
 * (format MUST be cjs: react-dom/server does require("util") internally,
 * which an esm bundle cannot satisfy — "Dynamic require not supported".)
 *
 * (Bare `npx tsc ... && node --test` cannot be used here: the registry
 * import graph pulls .tsx visuals, a .css import via GraphAlgorithmVisual,
 * and vite-only `import.meta.env` — all handled by the esbuild flags above.
 * React.createElement (no-JSX) style is kept in THIS file so no jsx config
 * beyond the bundler flag is needed for the test body itself.)
 *
 * RED on pre-todo-4 tree: a deque envelope ({"_type":"deque","items":[...]})
 * has no _type branch, so it falls through to "map"; DequeVisual does not
 * exist and the VariableRow diff path never flashes deque indices.
 *
 * GREEN: envelope routes "deque"; plain arrays still route "vector";
 * DequeVisual renders end-marked boxes (front ▸ on items[0], ◂ back on
 * items[-1]) with changedIndices flash; empty/malformed envelopes render
 * an empty state without throwing.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useContainerType } from "../src/hooks/useContainerType";
import { VISUAL_REGISTRY } from "../src/components/ContainerVisuals/registry";
import { VectorVisual } from "../src/components/ContainerVisuals/VectorVisual";
import { DequeVisual } from "../src/components/ContainerVisuals/DequeVisual";
import { PrimitiveFallback } from "../src/components/ContainerVisuals/registryComponents";
import { dequeItems } from "../src/utils/dequeItems";
import { diffIndices } from "../src/components/ContainerVisuals/flash";

/** Sliding-window deque as tracer.h __ser(deque) emits it. */
function slidingWindow() {
  return { _type: "deque", items: [2, 5, 1] };
}

describe("deque routing", () => {
  it("positive: deque envelope routes to deque", () => {
    assert.equal(useContainerType(slidingWindow()), "deque");
  });

  it("no regression: plain array still routes to vector", () => {
    assert.equal(useContainerType([2, 5, 1]), "vector");
  });

  it("empty deque envelope routes to deque (not map)", () => {
    assert.equal(useContainerType({ _type: "deque", items: [] }), "deque");
  });

  it("negative: deque envelope never routes to vector", () => {
    assert.notEqual(useContainerType(slidingWindow()), "vector");
  });
});

describe("deque unwrap helper", () => {
  it("unwraps {_type:deque,items} envelopes", () => {
    assert.deepEqual(dequeItems(slidingWindow()), [2, 5, 1]);
  });

  it("malformed: missing items key returns null (empty state, no throw)", () => {
    assert.equal(dequeItems({ _type: "deque" }), null);
  });

  it("malformed: non-array items returns null (empty state, no throw)", () => {
    assert.equal(dequeItems({ _type: "deque", items: "abc" }), null);
  });

  it("plain arrays are NOT deque envelopes (vector keeps its wire shape)", () => {
    assert.equal(dequeItems([1, 2, 3]), null);
  });
});

describe("deque registry + render", () => {
  it("registry maps deque kind to DequeVisual (not vector, not fallback)", () => {
    assert.equal(VISUAL_REGISTRY.deque, DequeVisual);
    assert.notEqual(VISUAL_REGISTRY.deque, VectorVisual);
    assert.notEqual(VISUAL_REGISTRY.deque, PrimitiveFallback);
    assert.equal(VISUAL_REGISTRY.vector, VectorVisual);
  });

  it("renders end-marked boxes: front marker on items[0], back marker on items[-1]", () => {
    const html = renderToStaticMarkup(
      React.createElement(DequeVisual, { value: slidingWindow(), name: "window" }),
    );
    assert.match(html, /front ▸/);
    assert.match(html, /◂ back/);
    assert.match(html, /data-testid="changed-cell"/);
    assert.match(html, /window: deque/);
  });

  it("push/pop flash: changedIndices flow to data-flash=true on those cells", () => {
    const html = renderToStaticMarkup(
      React.createElement(DequeVisual, {
        value: slidingWindow(),
        name: "window",
        changedIndices: [2],
      }),
    );
    assert.match(html, /data-index="2" data-flash="true"/);
    assert.match(html, /data-index="0" data-flash="false"/);
  });

  it("empty deque renders empty state without throwing", () => {
    const html = renderToStaticMarkup(
      React.createElement(DequeVisual, {
        value: { _type: "deque", items: [] },
        name: "window",
      }),
    );
    assert.match(html, /empty/);
  });

  it("malformed deque renders empty state without throwing", () => {
    for (const bad of [
      { _type: "deque" },
      { _type: "deque", items: "abc" },
      { _type: "deque", items: null },
    ]) {
      const html = renderToStaticMarkup(
        React.createElement(DequeVisual, { value: bad, name: "window" }),
      );
      assert.match(html, /empty/);
    }
  });
});

describe("deque diff wiring", () => {
  it("sliding-window step (pop front + push back) flashes via the SAME diffIndices vector uses", () => {
    // window [2,5,1] -> [5,1,4]: same length, shifted body + new tail.
    const changed = diffIndices(
      dequeItems(slidingWindow()),
      dequeItems({ _type: "deque", items: [5, 1, 4] }) ?? [],
    );
    assert.deepEqual(changed, [0, 1, 2]);
  });

  it("push_back growth flashes the new tail index", () => {
    const changed = diffIndices(
      dequeItems(slidingWindow()),
      dequeItems({ _type: "deque", items: [2, 5, 1, 4] }) ?? [],
    );
    assert.deepEqual(changed, [3]);
  });
});
