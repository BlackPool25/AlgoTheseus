/**
 * tests/dsu-kind.spec.ts — DSU (union-find) visual kind lock.
 *
 * RED-first: DSU serializes via the generic struct path as
 * {"$id", "$addr", "p": [...], "r": [...]} (see serializer_gen.py
 * _emit_struct; no _type discriminator). Before the fix,
 * useContainerType returns "struct" → PrimitiveFallback.
 *
 * GREEN: parent array [0,0,1,2] yields kind "dsu" and the grouped-sets
 * visual (data-testid "dsu-group"), not "primitive-fallback".
 */

import { test, expect, type Page } from "@playwright/test";

function dsuNDJSON(): string {
  const events = [
    { type: "enter", line: 1, func: "main", depth: 1, params: {} },
    {
      type: "state",
      line: 2,
      func: "main",
      depth: 1,
      vars: {
        dsu: { $id: 1, $addr: "0xabc", p: [0, 0, 0, 3], r: [1, 0, 0, 0] },
      },
    },
    { type: "exit", line: 3, func: "main", depth: 1, return_val: 0 },
  ];
  const lines = events.map((e) => JSON.stringify({ type: "event", data: e }));
  lines.push(
    JSON.stringify({
      type: "cfg",
      stdout: "",
      runtime_error: null,
      timed_out: false,
      truncated: false,
      cfg_nodes: [
        { id: "n0", type: "func_start", lines: [1], label: "main()", children: ["n1"], trace_indices: [0] },
        { id: "n1", type: "line", lines: [2], label: "body", children: ["n2"], trace_indices: [1] },
        { id: "n2", type: "func_end", lines: [3], label: "return", children: [], trace_indices: [2] },
      ],
      cfg_edges: [
        { source: "n0", target: "n1", label: "" },
        { source: "n1", target: "n2", label: "" },
      ],
      total_steps: events.length,
    }),
  );
  return lines.join("\n") + "\n";
}

async function setupWithMock(page: Page, ndjson: string) {
  await page.route("**/execute", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body: ndjson,
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: /^Run$/ }).click();
  await page.waitForSelector('input[aria-label="Trace step"]', { timeout: 10000 });
  await page.waitForTimeout(400);
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
  }, step);
  await page.waitForTimeout(400);
}

test("dsu struct renders grouped sets, not primitive fallback", async ({ page }) => {
  await setupWithMock(page, dsuNDJSON());
  await goToStep(page, 1);
  // Parent array [0,0,0,3] → sets {0,1,2} and {3}: two groups.
  await expect(page.getByTestId("dsu-group")).toHaveCount(2);
  await expect(page.getByTestId("primitive-fallback")).toHaveCount(0);
});

test("dsu groups contain the right members", async ({ page }) => {
  await setupWithMock(page, dsuNDJSON());
  await goToStep(page, 1);
  const groups = page.getByTestId("dsu-group");
  await expect(groups.first()).toContainText("0");
  await expect(groups.first()).toContainText("1");
  await expect(groups.first()).toContainText("2");
  await expect(groups.last()).toContainText("3");
});
