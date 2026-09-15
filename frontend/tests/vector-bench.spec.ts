/**
 * tests/vector-bench.spec.ts — Todo 25 vector-flash tripwire (R7.6).
 *
 * Scrubs a 1k-element vector step pair and records the median navigation+
 * render latency. First run writes frontend/bench/vector-baseline.json
 * (committed); later runs PASS iff median <= 1.2x baseline, else FAIL
 * with the measured ratio.
 */

import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const BASELINE_PATH = path.join(import.meta.dirname, "..", "bench", "vector-baseline.json");
const TRIPWIRE = 1.2;
const SAMPLES = 15;

function benchNDJSON(): string {
  const v1 = Array.from({ length: 1000 }, (_, i) => i);
  const v2 = [...v1];
  v2[500] = -1;
  const ev = [
    { type: "enter", line: 1, func: "main", depth: 1, params: {} },
    { type: "state", line: 2, func: "main", depth: 1, vars: { arr: v1 } },
    { type: "state", line: 3, func: "main", depth: 1, vars: { arr: v2 } },
    { type: "exit", line: 4, func: "main", depth: 1, return_val: 0 },
  ];
  const lines = ev.map((e) => JSON.stringify({ type: "event", data: e }));
  lines.push(JSON.stringify({
    type: "cfg", stdout: "", runtime_error: null, timed_out: false, truncated: false,
    cfg_nodes: [
      { id: "n0", type: "func_start", lines: [1], label: "main()", children: ["n1"], trace_indices: [0] },
      { id: "n1", type: "line", lines: [2, 3], label: "body", children: ["n2"], trace_indices: [1, 2] },
      { id: "n2", type: "func_end", lines: [4], label: "return", children: [], trace_indices: [3] },
    ],
    cfg_edges: [
      { source: "n0", target: "n1", label: "" },
      { source: "n1", target: "n2", label: "" },
    ],
    total_steps: 4,
  }));
  return lines.join("\n") + "\n";
}

async function nav(page: import("@playwright/test").Page, step: number) {
  const t0 = await page.evaluate(() => performance.now());
  await page.evaluate((s) => {
    const el = document.querySelector<HTMLInputElement>('input[aria-label="Trace step"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(el, String(s));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, step);
  await page.getByText(`Step ${step + 1} / 4`, { exact: false }).first().waitFor({ timeout: 10000 });
  const t1 = await page.evaluate(() => performance.now());
  return t1 - t0;
}

test("vector 1k scrub median within 1.2x baseline", async ({ page }) => {
  await page.route("**/execute", (route) =>
    route.fulfill({ status: 200, contentType: "application/x-ndjson", body: benchNDJSON() }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: /^Run$/ }).click();
  await page.waitForSelector('input[aria-label="Trace step"]', { timeout: 10000 });
  await page.waitForTimeout(500);

  const samples: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    samples.push(await nav(page, 2));
    samples.push(await nav(page, 1));
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];

  // Untimed flash-correctness probe: the 1k vector is virtualized, so
  // scroll the mutated cell (index 500) into the render window first.
  await nav(page, 2);
  await page.evaluate(() => {
    const cell = document.querySelector('[data-testid="changed-cell"]');
    const scroller = cell?.closest(".overflow-x-auto");
    if (scroller) scroller.scrollLeft = 500 * 34;
  });
  await page.waitForTimeout(400);
  await expect(page.locator('[data-testid="changed-cell"][data-flash="true"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="changed-cell"][data-flash="true"]')).toHaveAttribute("data-index", "500");

  if (!fs.existsSync(BASELINE_PATH)) {
    fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
    fs.writeFileSync(BASELINE_PATH, JSON.stringify({ median_ms: median, samples: samples.length, vector_len: 1000, tripwire: TRIPWIRE }, null, 2) + "\n");
    console.log(`BASELINE_WRITTEN median=${median.toFixed(2)}ms`);
    return;
  }
  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")) as { median_ms: number };
  const ratio = median / baseline.median_ms;
  console.log(`VECTOR_GUARD median=${median.toFixed(2)}ms baseline=${baseline.median_ms.toFixed(2)}ms ratio=${ratio.toFixed(3)}`);
  expect(ratio, `vector-flash regression: ratio ${ratio.toFixed(3)} > ${TRIPWIRE}`).toBeLessThanOrEqual(TRIPWIRE);
});
