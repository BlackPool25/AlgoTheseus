import { test, expect, type Page } from "@playwright/test";
import { createFrameStdoutNDJSON } from "./mockData";

/**
 * Bug-A regression: with 2 frames on the call stack the VARIABLES panel
 * must render exactly ONE "· current" frame header. The per-frame tables
 * (Copy A) already include the current frame, so the flat list (Copy B)
 * must not add a second "Frame · current" header — while its diff-aware
 * rows (e.g. helper var y) stay visible.
 */

async function setupWithMock(page: Page) {
  await page.route("**/execute", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body: createFrameStdoutNDJSON(),
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

test("bugA: single current-frame header with 2 frames on stack", async ({ page }) => {
  await setupWithMock(page);

  // Step 3 = helper state: call stack holds [main, helper] (2 frames).
  await goToStep(page, 3);
  await expect(page.getByText(/^Step 4 \/ 7/)).toBeVisible();

  // Both frames render in the per-frame tables …
  await expect(page.getByTestId("frame-table")).toHaveCount(2);
  // … but the current-frame header appears exactly once.
  await expect(page.getByText("· current")).toHaveCount(1);

  // Copy-B diff-aware rows are preserved: helper var y is visible.
  await expect(page.getByText("helper()").first()).toBeVisible();
  await expect(page.getByTestId("frame-table").first()).toContainText("y");
});

test("bugA2: current-frame var renders exactly once with 2 frames on stack", async ({
  page,
}) => {
  await setupWithMock(page);

  // Step 3 = helper state: call stack holds [main, helper] (2 frames).
  await goToStep(page, 3);
  await expect(page.getByText(/^Step 4 \/ 7/)).toBeVisible();
  await expect(page.getByTestId("frame-table")).toHaveCount(2);

  // Current-frame var y must appear EXACTLY ONCE — the frame table owns
  // the current frame (with diff badges), the flat list must not repeat it.
  await expect(page.getByTestId("var-row-y")).toHaveCount(1);
});

test("frames: per-frame headers are visually distinct", async ({ page }) => {
  await setupWithMock(page);

  await goToStep(page, 3);
  await expect(page.getByText(/^Step 4 \/ 7/)).toBeVisible();

  // Each frame table carries a distinct header: FRAME badge + func name +
  // depth chip, with a per-depth accent separating current from caller.
  const headers = page.getByTestId("frame-header");
  await expect(headers).toHaveCount(2);
  await expect(headers.first()).toContainText("FRAME");
  await expect(headers.first()).toContainText("depth");
  const currentAccent = await headers
    .first()
    .evaluate((el) => getComputedStyle(el).borderLeftColor);
  const callerAccent = await headers
    .nth(1)
    .evaluate((el) => getComputedStyle(el).borderLeftColor);
  expect(currentAccent).not.toBe(callerAccent);
});
