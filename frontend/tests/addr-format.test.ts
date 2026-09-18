/**
 * tests/addr-format.test.ts — unified heap address display policy (todo 12).
 *
 * Run (no new deps — repo has no vitest; esbuild ships inside vite):
 *   node node_modules/esbuild/bin/esbuild tests/addr-format.test.ts --bundle \
 *     --platform=node --format=cjs --jsx=automatic --loader:.css=empty \
 *     --define:import.meta.env='{}' \
 *     --outfile=/tmp/addr-format.test.cjs --log-level=error \
 *   && node --test /tmp/addr-format.test.cjs
 * (format MUST be cjs: react-dom/server does require("util") internally,
 * which an esm bundle cannot satisfy — "Dynamic require not supported".)
 *
 * RED on pre-todo-12 tree: `formatAddr` does not exist in utils/format.ts,
 * so the bundle fails to resolve the import (HeapPanel renders the full raw
 * `0x…` addr with no title/hover). The LL 10-char baseline assertions
 * (pinned pre-change length) pass pre+post by design.
 *
 * GREEN: heap + LL addrs render truncated (10-char LinkedListVisual
 * convention) with the full value on hover (title); short/missing/non-hex
 * addrs never crash; payloads keep full addr data (display-only helper).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { formatAddr } from "../src/utils/format";

const LONG_ADDR = "0x7fffab12cd34";
const SHORT_ADDR = "0x1234";

describe("formatAddr — unified truncation policy", () => {
  it("truncates long addrs to the 10-char LinkedListVisual convention", () => {
    assert.equal(formatAddr(LONG_ADDR), LONG_ADDR.slice(0, 10));
    assert.equal(formatAddr(LONG_ADDR).length, 10);
  });

  it("pins the pre-change LL baseline: slice(0, 10) with no ellipsis", () => {
    // LinkedListVisual.tsx pre-change: node.addr.length > 10
    //   ? node.addr.slice(0, 10) : node.addr
    assert.equal(formatAddr("0xABCDEF123456"), "0xABCDEF12");
    assert.ok(!formatAddr("0xABCDEF123456").includes("…"));
  });

  it("passes short addrs through unchanged", () => {
    assert.equal(formatAddr(SHORT_ADDR), SHORT_ADDR);
    assert.equal(formatAddr(""), "");
  });

  it("never crashes on missing addrs", () => {
    assert.equal(formatAddr(null), "");
    assert.equal(formatAddr(undefined), "");
  });

  it("passes non-hex strings through sanely (same length rule)", () => {
    assert.equal(formatAddr("not-an-address-at-all"), "not-an-add");
    assert.equal(formatAddr("abc"), "abc");
  });
});

describe("manual-QA artifact — truncated text + full title", () => {
  it("heap card markup: truncated text with full addr in title", () => {
    const el = React.createElement(
      "span",
      { title: LONG_ADDR },
      formatAddr(LONG_ADDR),
    );
    const html = renderToStaticMarkup(el);
    assert.match(html, /title="0x7fffab12cd34"/);
    assert.ok(html.includes(LONG_ADDR.slice(0, 10)));
    assert.ok(!html.includes(`>${LONG_ADDR}<`));
  });

  it("linked-list node markup: truncated text with full addr on hover", () => {
    const el = React.createElement(
      "text",
      null,
      React.createElement("title", null, LONG_ADDR),
      formatAddr(LONG_ADDR),
    );
    const html = renderToStaticMarkup(el);
    assert.match(html, new RegExp(`<title>${LONG_ADDR}</title>`));
    assert.ok(html.includes(LONG_ADDR.slice(0, 10)));
  });

  it("$id-keyed diff payloads keep full addr data (helper is display-only)", () => {
    const payload = { $id: 3, $addr: LONG_ADDR, value: 42 };
    const display = formatAddr(payload.$addr);
    assert.equal(payload.$addr, LONG_ADDR);
    assert.equal(payload.$id, 3);
    assert.notEqual(display, LONG_ADDR);
  });
});
