import { test, expect, type Page } from "@playwright/test";
import {
  createPrintLoopNDJSON,
  createHeapDriftNDJSON,
  createDroppedStreamNDJSON,
} from "./mockData";

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

test.describe("T10 end-to-end phase-2 wiring", () => {
  test("27: print-loop output grows line-by-line, identical vars never merge", async ({ page }) => {
    await setupWithMock(page, createPrintLoopNDJSON());

    // Core bug: identical-vars groups must not hide growing stdout.
    await expect(page.getByText(/identical steps/)).toHaveCount(0);

    const box = page.getByTestId("program-output");
    await goToStep(page, 1);
    const first = await box.innerText();
    expect(first).toContain("1");
    expect(first).not.toContain("3");

    await goToStep(page, 2);
    const second = await box.innerText();
    expect(second.length).toBeGreaterThan(first.length);
    expect(second).toContain("2");

    await goToStep(page, 3);
    const third = await box.innerText();
    expect(third.length).toBeGreaterThan(second.length);
    expect(third).toContain("3");

    // Every raw step stays scrub-reachable with a plain Step label.
    await expect(page.getByText(/^Step 4 \/ 5/)).toBeVisible();
  });

  test("28: identical vars with differing heap never merge", async ({ page }) => {
    await setupWithMock(page, createHeapDriftNDJSON());

    await expect(page.getByText(/identical steps/)).toHaveCount(0);
    await goToStep(page, 2);
    await expect(page.getByText(/^Step 3 \/ 4/)).toBeVisible();
  });

  test("29: stream dropping mid-run lands in error state with banner, never hangs", async ({ page }) => {
    await page.route("**/execute", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/x-ndjson",
        body: createDroppedStreamNDJSON(),
      });
    });

    await page.goto("/");
    await page.getByRole("button", { name: /^Run$/ }).click();
    // No cfg line ever arrives: the Run button must not be stuck on Running…
    await expect(page.getByRole("button", { name: /^Run$/ })).toBeEnabled({ timeout: 10000 });
    await expect(page.getByText(/unexpectedly|stream/i).first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('input[aria-label="Trace step"]')).toHaveCount(0);
  });

  test("30: new fields flow stream to panels (step_desc header + globals)", async ({ page }) => {
    await setupWithMock(page, createPrintLoopNDJSON());

    await goToStep(page, 1);
    await expect(page.getByTestId("step-desc-header")).toHaveText("assign limit = 3");
    await expect(page.getByTestId("globals-section")).toBeVisible();
  });
});
