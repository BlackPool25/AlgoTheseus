import { test, expect, type Page } from "@playwright/test";
import {
  createMockNDJSON,
  createStepDescNDJSON,
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

test.describe("Step descriptions + globals (T5 phase-1)", () => {
  test("19: step_desc renders as header line at step 0", async ({ page }) => {
    await setupWithMock(page, createStepDescNDJSON());

    await expect(page.getByTestId("step-desc-header")).toHaveText("call main()");
    await expect(page.getByText(/Step 1 \/ 4.*call main\(\)/)).toBeVisible();
  });

  test("20: globals section collapsible above frame vars", async ({ page }) => {
    await setupWithMock(page, createStepDescNDJSON());

    await page.evaluate(() => {
      const el = document.querySelector<HTMLInputElement>(
        'input[aria-label="Trace step"]',
      );
      if (!el) return;
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(el, String(1));
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForTimeout(600);

    const globals = page.getByTestId("globals-section");
    await expect(globals).toBeVisible();
    await expect(globals.getByText("g", { exact: true })).toBeVisible();
    await expect(page.getByTestId("step-desc-header")).toHaveText("assign x = 2");

    await globals.getByRole("button", { name: /Globals/ }).click();
    await expect(globals.getByText("g", { exact: true })).not.toBeVisible();
  });

  test("21: legacy trace without v2 fields renders flat, no crash", async ({ page }) => {
    await setupWithMock(page, createMockNDJSON());

    await expect(page.getByText("Variables", { exact: true })).toBeVisible();
    await expect(page.getByTestId("step-desc-header")).toHaveCount(0);
    await expect(page.getByTestId("globals-section")).toHaveCount(0);
    await expect(page.locator('input[aria-label="Trace step"]')).toBeVisible();
  });
});
