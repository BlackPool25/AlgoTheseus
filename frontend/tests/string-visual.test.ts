/**
 * tests/string-visual.test.ts — indexed string visual (todo 5).
 *
 * Run (no new deps — repo has no vitest; esbuild ships inside vite):
 *   node node_modules/esbuild/bin/esbuild tests/string-visual.test.ts --bundle \
 *     --platform=node --format=cjs --jsx=automatic --loader:.css=empty \
 *     --define:import.meta.env='{}' \
 *     --outfile=/tmp/string-visual.test.cjs --log-level=error \
 *   && node --test /tmp/string-visual.test.cjs
 * (format MUST be cjs: react-dom/server does require("util") internally,
 * which an esm bundle cannot satisfy — "Dynamic require not supported".)
 *
 * (Bare `npx tsc ... && node --test` cannot be used here: the registry
 * import graph pulls .tsx visuals, a .css import via GraphAlgorithmVisual,
 * and vite-only `import.meta.env` — all handled by the esbuild flags above.
 * React.createElement (no-JSX) style is kept in THIS file so no jsx config
 * beyond the bundler flag is needed for the test body itself.)
 *
 * RED on pre-todo-5 tree: JSON strings hit the `typeof value !== "object"`
 * early return and route "primitive" (rendering as truncated 20-char text
 * via renderCellValue); StringVisual does not exist so this spec does not
 * even bundle.
 *
 * GREEN: "abc" routes "string" and renders 3 indexed char boxes with
 * highlightIndex support; numbers/booleans/null stay primitive; empty
 * string renders an empty state without throwing.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useContainerType } from "../src/hooks/useContainerType";
import { VISUAL_REGISTRY } from "../src/components/ContainerVisuals/registry";
import { VectorVisual } from "../src/components/ContainerVisuals/VectorVisual";
import { StringVisual } from "../src/components/ContainerVisuals/StringVisual";
import { PrimitiveFallback } from "../src/components/ContainerVisuals/registryComponents";

describe("string routing", () => {
  it('positive: "abc" routes to string (not primitive)', () => {
    assert.equal(useContainerType("abc"), "string");
  });

  it("no regression: numbers/booleans/null stay primitive", () => {
    assert.equal(useContainerType(42), "primitive");
    assert.equal(useContainerType(true), "primitive");
    assert.equal(useContainerType(null), "primitive");
    assert.equal(useContainerType(undefined), "primitive");
  });

  it("empty string routes to string (visual owns the empty state)", () => {
    assert.equal(useContainerType(""), "string");
  });

  it("long strings route to string (no truncation fallback)", () => {
    assert.equal(useContainerType("abcdefghijklmnopqrstuvwxyz"), "string");
  });
});

describe("string registry + render", () => {
  it("registry maps string kind to StringVisual (not vector, not fallback)", () => {
    assert.equal(VISUAL_REGISTRY.string, StringVisual);
    assert.notEqual(VISUAL_REGISTRY.string, VectorVisual);
    assert.notEqual(VISUAL_REGISTRY.string, PrimitiveFallback);
  });

  it('"abc" renders 3 indexed char boxes with indices 0..2', () => {
    const html = renderToStaticMarkup(
      React.createElement(StringVisual, { value: "abc", name: "s" }),
    );
    assert.match(html, /s: string/);
    const cells = html.match(/data-testid="changed-cell"/g) ?? [];
    assert.equal(cells.length, 3);
    assert.match(html, /data-index="0"/);
    assert.match(html, /data-index="1"/);
    assert.match(html, /data-index="2"/);
    assert.match(html, />a</);
    assert.match(html, />b</);
    assert.match(html, />c</);
  });

  it("highlightIndex flows to the highlighted cell", () => {
    const html = renderToStaticMarkup(
      React.createElement(StringVisual, {
        value: "abc",
        name: "s",
        highlightIndex: 1,
      }),
    );
    // Highlighted box shares the flash border/fill language; class precedes
    // data-index in the emitted markup (className, style, title, ...attrs).
    assert.match(html, /viz-flash[^>]*data-index="1"/);
    assert.match(html, /data-index="1" data-flash="false"/);
  });

  it("changedIndices flash via the shared data-attr contract", () => {
    const html = renderToStaticMarkup(
      React.createElement(StringVisual, {
        value: "abc",
        name: "s",
        changedIndices: [2],
      }),
    );
    assert.match(html, /data-index="2" data-flash="true"/);
    assert.match(html, /data-index="0" data-flash="false"/);
  });

  it("palindrome fixture: full string visible, no 20-char truncation", () => {
    // 26 chars — renderCellValue would truncate this to 20 + "…".
    const s = "abcdefghijklmnopqrstuvwxyz";
    const html = renderToStaticMarkup(
      React.createElement(StringVisual, { value: s, name: "s" }),
    );
    const cells = html.match(/data-testid="changed-cell"/g) ?? [];
    assert.equal(cells.length, 26);
    assert.match(html, /data-index="25"/);
    assert.match(html, />z</);
    assert.doesNotMatch(html, /…/);
  });

  it("LCS fixture: pair of strings render indexed boxes independently", () => {
    const a = renderToStaticMarkup(
      React.createElement(StringVisual, { value: "abcde", name: "a" }),
    );
    const b = renderToStaticMarkup(
      React.createElement(StringVisual, {
        value: "ace",
        name: "b",
        highlightIndex: 2,
      }),
    );
    assert.equal((a.match(/data-testid="changed-cell"/g) ?? []).length, 5);
    assert.equal((b.match(/data-testid="changed-cell"/g) ?? []).length, 3);
    assert.match(b, /viz-flash[^>]*data-index="2"/);
  });

  it("empty string renders empty state without throwing", () => {
    const html = renderToStaticMarkup(
      React.createElement(StringVisual, { value: "", name: "s" }),
    );
    assert.match(html, /empty/);
  });

  it("very long string renders without crashing (virtualized path)", () => {
    const s = "ab".repeat(250);
    const html = renderToStaticMarkup(
      React.createElement(StringVisual, { value: s, name: "s" }),
    );
    assert.match(html, /s: string \(500\)/);
  });
});
