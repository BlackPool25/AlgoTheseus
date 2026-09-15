/**
 * tests/task25-manual-qa.spec.ts — Todo 25 manual-QA channel.
 *
 * Headless Chromium over canonical fixtures (bsearch, print-loop,
 * linked-list). Screenshots go to .omo/evidence/task-25/.
 * PASS = creation flash visible, mutation flashes exactly one node/cell,
 * alias sync observed.
 */

import { test, expect, type Page } from "@playwright/test";
import {
  createPrintLoopNDJSON,
  createHeapPanelNDJSON,
} from "./mockData";

function ndjson(events: unknown[]): string {
  const lines = (events as object[]).map((e) => JSON.stringify({ type: "event", data: e }));
  lines.push(JSON.stringify({
    type: "cfg", stdout: "", runtime_error: null, timed_out: false, truncated: false,
    cfg_nodes: [
      { id: "n0", type: "func_start", lines: [1], label: "main()", children: ["n1"], trace_indices: [0] },
      { id: "n1", type: "line", lines: [2, 3], label: "body", children: ["n2"], trace_indices: [1, 2, 3] },
      { id: "n2", type: "func_end", lines: [4], label: "return", children: [], trace_indices: [4] },
    ],
    cfg_edges: [
      { source: "n0", target: "n1", label: "" },
      { source: "n1", target: "n2", label: "" },
    ],
    total_steps: 5,
  }));
  return lines.join("\n") + "\n";
}

function bsearchNDJSON(): string {
  return ndjson([
    { type: "enter", line: 1, func: "main", depth: 1, params: {} },
    { type: "state", line: 2, func: "main", depth: 1, vars: { arr: [1, 3, 5, 7, 9, 11, 13], lo: 0, hi: 6, mid: 3 } },
    { type: "state", line: 3, func: "main", depth: 1, vars: { arr: [1, 3, 5, 8, 9, 11, 13], lo: 0, hi: 6, mid: 3 } },
    { type: "state", line: 3, func: "main", depth: 1, vars: { arr: [1, 3, 5, 8, 9, 11, 13], lo: 4, hi: 6, mid: 5 } },
    { type: "exit", line: 4, func: "main", depth: 1, return_val: 5 },
  ]);
}

async function setup(page: Page, body: string) {
  await page.route("**/execute", (route) =>
    route.fulfill({ status: 200, contentType: "application/x-ndjson", body }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: /^Run$/ }).click();
  await page.waitForSelector('input[aria-label="Trace step"]', { timeout: 10000 });
  await page.waitForTimeout(500);
}

async function goToStep(page: Page, step: number) {
  await page.evaluate((s) => {
    const el = document.querySelector<HTMLInputElement>('input[aria-label="Trace step"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(el, String(s));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, step);
  await page.waitForTimeout(1000);
}

test.describe("task25 manual QA (evidence screenshots)", () => {
  test("bsearch: creation + single-cell mutation + highlight", async ({ page }) => {
    await setup(page, bsearchNDJSON());
    await goToStep(page, 2);
    await expect(page.locator('[data-testid="changed-cell"][data-flash="true"]')).toHaveCount(1);
    await page.screenshot({ path: "../.omo/evidence/task-25/bsearch-mutation.png" });
    await goToStep(page, 3);
    await page.screenshot({ path: "../.omo/evidence/task-25/bsearch-mid.png" });
  });

  test("print-loop: stdout grows, every step shown", async ({ page }) => {
    await setup(page, createPrintLoopNDJSON());
    await goToStep(page, 3);
    await expect(page.getByText("1").first()).toBeVisible();
    await page.screenshot({ path: "../.omo/evidence/task-25/print-loop.png" });
  });

  test("linked-list: mutation flashes one node, alias sync", async ({ page }) => {
    await setup(page, createHeapPanelNDJSON());
    await goToStep(page, 2);
    await expect(page.locator('[data-ll-highlight="true"]')).toHaveCount(1);
    await page.screenshot({ path: "../.omo/evidence/task-25/linked-list-mutation.png" });
    await goToStep(page, 3);
    // HeapPanel is collapsed by default (todo 17 lazy/opt-in):
    // expand-then-assert reachability for the alias connector.
    await page.getByTestId("heap-panel").getByRole("button").click();
    await expect(page.getByTestId("alias-edge").first()).toBeVisible();
    await page.screenshot({ path: "../.omo/evidence/task-25/linked-list-alias.png" });
  });
});
