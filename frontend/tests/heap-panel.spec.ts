import { test, expect, type Page } from "@playwright/test";
import { createHeapPanelNDJSON, createMockNDJSON, createGridMutationNDJSON } from "./mockData";

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
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, step);
  await page.waitForTimeout(600);
}

test.describe("T12 HeapPanel with per-object flash and alias connectors", () => {
  test("31: heap graph renders one box per $id, collapsed by default", async ({ page }) => {
    await setupWithMock(page, createHeapPanelNDJSON());
    await goToStep(page, 1);

    const panel = page.getByTestId("heap-panel");
    await expect(panel).toBeVisible();
    // R6.1 lazy/opt-in: collapsed by default, expands on demand.
    await expect(panel.getByTestId("heap-node")).toHaveCount(0);
    await panel.getByRole("button", { name: /heap/i }).click();
    await expect(panel.getByTestId("heap-node")).toHaveCount(3);
  });

  test("32: single-field mutation flashes ONLY the mutated node", async ({ page }) => {
    await setupWithMock(page, createHeapPanelNDJSON());
    await goToStep(page, 2);

    const panel = page.getByTestId("heap-panel");
    await panel.getByRole("button", { name: /heap/i }).click();
    const nodes = panel.getByTestId("heap-node");
    await expect(nodes).toHaveCount(3);
    // R6.3 drop condition: exactly one node flashes, never the whole structure.
    await expect(panel.locator('[data-flash="true"]')).toHaveCount(1);
    await expect(
      panel.locator('[data-heap-id="2"][data-flash="true"]'),
    ).toBeVisible();
    await expect(
      panel.locator('[data-heap-id="1"][data-flash="true"]'),
    ).toHaveCount(0);
    await expect(
      panel.locator('[data-heap-id="3"][data-flash="true"]'),
    ).toHaveCount(0);
    // Field granularity: the changed field is named on the flashed node.
    await expect(
      panel.locator('[data-heap-id="2"]').getByText("val"),
    ).toBeVisible();
    // R6.5: currentAddr ← $id — the mutated node's list arrow flashes amber…
    await expect(page.locator('[data-ll-highlight="true"]')).toHaveCount(1);
    // …while the creation step (no mutation) highlights nothing.
    await goToStep(page, 1);
    await expect(page.locator('[data-ll-highlight="true"]')).toHaveCount(0);
  });

  test("33: alias connector visible for multi-inbound id, $cycle badge on self-ref", async ({ page }) => {
    await setupWithMock(page, createHeapPanelNDJSON());
    await goToStep(page, 3);

    const panel = page.getByTestId("heap-panel");
    await panel.getByRole("button", { name: /heap/i }).click();
    // "2" has two inbound sources (1.next + alias var) → one alias connector.
    await expect(panel.locator('[data-alias-target="2"]')).toBeVisible();
    // "3" refs itself → $cycle badge.
    await expect(panel.getByText("$cycle").first()).toBeVisible();
    // Hover on node "2" highlights its inbound edges.
    await panel.locator('[data-heap-id="2"]').hover();
    await expect(
      panel.locator('[data-alias-highlight="true"]').first(),
    ).toBeVisible();
  });

  test("34: heap-less trace hides HeapPanel, LinkedList falls back", async ({ page }) => {
    await setupWithMock(page, createMockNDJSON());
    await goToStep(page, 9);

    await expect(page.getByTestId("heap-panel")).toHaveCount(0);
    await expect(page.getByTestId("heap-node")).toHaveCount(0);
    await expect(page.getByTestId("alias-edge")).toHaveCount(0);
  });

  test("35: R6.5 grid changingCells/highlightedCells populate on cell mutation", async ({ page }) => {
    await setupWithMock(page, createGridMutationNDJSON());
    await goToStep(page, 2);

    // The mutated cell carries the amber highlight border…
    await expect(page.locator('div[title="[0, 1] = 9"]')).toHaveCSS(
      "border",
      /2px solid rgb\(245, 158, 11\)/,
    );
    // …the footer names the changing cell, and untouched cells stay borderless.
    await expect(page.getByText("changing: 1 cells")).toBeVisible();
    await expect(page.locator('div[title="[0, 0] = 1"]')).not.toHaveCSS(
      "border",
      /2px solid rgb\(245, 158, 11\)/,
    );
  });
});
