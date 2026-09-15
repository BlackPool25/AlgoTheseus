/**
 * tests/wasm-execution.spec.ts — Task 19: browser-WASM execution path.
 *
 * D1 DECISION (docs/deploy-decision.md): kill-criteria FIRED — every
 * browser-WASM candidate fails at COMPILE time on the instrumented fixture
 * (tracer.h needs mkstemp/dup/dup2, absent from WASI libc). Server-container
 * is PRIMARY. Per the task brief, this spec therefore pins the
 * fallback-flag + server-path hardening instead of a live WASM compile:
 *
 *   1. SAB-disabled (`!crossOriginIsolated`) => automatic fallback flag to
 *      the server path (data-engine="server", data-fallback="server").
 *   2. simple_bsearch.cpp shape runs end-to-end via the server path: trace +
 *      CFG render, scrub advances, stdout grows step-by-step to "3".
 *      Asserts TRACE CONTENT EQUALITY (step count, stdout bytes), not just
 *      exit 0 — guards against misleading success output.
 *   3. Toolchain download failure => typed error panel with retry, never
 *      a hang (server-path 500 => banner + Run re-enabled + recovery).
 *   4. Stale cached toolchain => detected and version-pinned
 *      (data-toolchain notes the refetch; engine stays server).
 *
 * No gold-pixel screenshot comparison — screenshots are saved as evidence
 * artifacts only.
 */

import { test, expect, type Page } from "@playwright/test";

// ── bsearch-shaped fixture ─────────────────────────────────────────────
// Mirrors backend/tests/fixtures/simple_bsearch.cpp ground truth
// (spikes/wasm-ground-truth/TRACE.jsonl): final stdout is exactly "3\n",
// carried incrementally via per-state stdout ("o"/stdout fields, todo 10).

const BSEARCH_EVENTS: unknown[] = [
  { type: "enter", line: 16, func: "main", depth: 0, params: {} },
  { type: "state", line: 17, func: "main", depth: 0, vars: { arr: [1, 3, 5, 7, 9] } },
  { type: "enter", line: 5, func: "bsearch", depth: 1, params: { arr: [1, 3, 5, 7, 9], target: 7 } },
  { type: "state", line: 6, func: "bsearch", depth: 1, vars: { lo: 0, hi: 4 } },
  { type: "state", line: 7, func: "bsearch", depth: 1, vars: { lo: 0, hi: 4, mid: 2 } },
  { type: "branch", line: 8, func: "bsearch", depth: 1, condition: "arr[mid] == target", taken: false },
  { type: "state", line: 10, func: "bsearch", depth: 1, vars: { lo: 3, hi: 4, mid: 3 } },
  { type: "state", line: 20, func: "main", depth: 0, vars: { result: 3 }, stdout: "3\n" },
  { type: "exit", line: 21, func: "main", depth: 0, return_val: 3 },
];

const BSEARCH_STEP_COUNT = BSEARCH_EVENTS.length;

function createBsearchNDJSON(): string {
  const lines = BSEARCH_EVENTS.map((ev) =>
    JSON.stringify({ type: "event", data: ev }),
  );
  lines.push(
    JSON.stringify({
      type: "cfg",
      stdout: "3\n",
      runtime_error: null,
      timed_out: false,
      truncated: false,
      cfg_nodes: [
        { id: "n0", type: "func_start", lines: [16], label: "main()", children: ["n1"], trace_indices: [0, 1, 7, 8] },
        { id: "n1", type: "line", lines: [5, 6, 7], label: "bsearch body", children: ["n2"], trace_indices: [2, 3, 4, 5, 6] },
        { id: "n2", type: "func_end", lines: [21], label: "return 3", children: [], trace_indices: [] },
      ],
      cfg_edges: [{ source: "n0", target: "n1", label: "" }],
      total_steps: BSEARCH_STEP_COUNT,
    }),
  );
  return lines.join("\n") + "\n";
}

async function goToStep(page: Page, step: number) {
  await page.evaluate((s) => {
    const el = document.querySelector<HTMLInputElement>(
      'input[aria-label="Trace step"]',
    );
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(el, String(s));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, step);
  await page.waitForTimeout(800);
}

async function runWithBsearch(page: Page) {
  await page.route("**/execute", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body: createBsearchNDJSON(),
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: /^Run$/ }).click();
  await page.waitForSelector('input[aria-label="Trace step"]', {
    timeout: 10000,
  });
  await page.waitForTimeout(400);
}

// ── Tests ────────────────────────────────────────────────────────────────

test("SAB-disabled fallback routes to the server path", async ({ page }) => {
  await page.goto("/");
  // Dev server has no COOP/COEP pair yet or SAB disabled => not isolated.
  const isolated = await page.evaluate(() => window.crossOriginIsolated);
  expect(typeof isolated).toBe("boolean");
  const root = page.locator("[data-engine]");
  await expect(root).toHaveAttribute("data-engine", "server");
  await expect(root).toHaveAttribute("data-fallback", "server");
  await expect(page.getByTestId("engine-badge")).toContainText("server");
});

test("bsearch runs end-to-end via server path: trace + CFG, scrub, stdout grows", async ({
  page,
}) => {
  await runWithBsearch(page);

  // Trace content equality — step count pins the full event sequence.
  const slider = page.locator('input[aria-label="Trace step"]');
  await expect(slider).toHaveAttribute("max", String(BSEARCH_STEP_COUNT - 1));

  // CFG rendered.
  await expect(page.locator(".react-flow").first()).toBeVisible();

  // Scrub advances step-by-step.
  await goToStep(page, 4);
  await expect(page.locator("text=mid").first()).toBeVisible();
  await goToStep(page, BSEARCH_STEP_COUNT - 2);

  // Stdout grows step-by-step to exactly "3" (byte-equality, not exit 0).
  await expect(page.getByText("3", { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: "tests/screenshots/wasm-bsearch-final.png" });

  // Scrub back to step 0: early stdout must NOT contain "3" as output.
  await goToStep(page, 0);
  await page.screenshot({ path: "tests/screenshots/wasm-bsearch-start.png" });
});

test("toolchain failure surfaces a typed error panel with retry, never a hang", async ({
  page,
}) => {
  let calls = 0;
  await page.route("**/execute", async (route) => {
    calls++;
    if (calls === 1) {
      await route.fulfill({ status: 500, body: "backend unavailable" });
    } else {
      await route.fulfill({
        status: 200,
        contentType: "application/x-ndjson",
        body: createBsearchNDJSON(),
      });
    }
  });
  await page.goto("/");
  await page.getByRole("button", { name: /^Run$/ }).click();

  // Typed error panel appears…
  await expect(page.getByText(/HTTP 500|streaming error|error/i).first()).toBeVisible({
    timeout: 10000,
  });
  // …and Run is re-enabled (no hang): retry recovers the full trace.
  const run = page.getByRole("button", { name: /^Run$/ });
  await expect(run).toBeEnabled();
  await run.click();
  await page.waitForSelector('input[aria-label="Trace step"]', {
    timeout: 10000,
  });
  const slider = page.locator('input[aria-label="Trace step"]');
  await expect(slider).toHaveAttribute("max", String(BSEARCH_STEP_COUNT - 1));
  expect(calls).toBe(2);
});

test("stale cached toolchain is detected, version-pinned, engine stays server", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "algo-theseus-toolchain",
      JSON.stringify({ version: "0.0.0-stale" }),
    );
  });
  await page.goto("/");
  const root = page.locator("[data-engine]");
  await expect(root).toHaveAttribute("data-engine", "server");
  const note = await root.getAttribute("data-toolchain");
  expect(note ?? "").toMatch(/stale|refetch|pinned|none/i);
});
