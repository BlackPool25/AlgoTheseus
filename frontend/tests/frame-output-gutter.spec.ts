import { test, expect, type Page } from "@playwright/test";
import {
  createMockNDJSON,
  createFrameStdoutNDJSON,
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
  await page.waitForTimeout(1000);
}

test.describe("T9 phase-2: frame tables + ProgramOutputBox + two-arrow gutter", () => {
  test("22: two frames visible as frame tables at nested step", async ({ page }) => {
    await setupWithMock(page, createFrameStdoutNDJSON());
    await goToStep(page, 4);

    const tables = page.getByTestId("frame-table");
    await expect(tables).toHaveCount(2);
    await expect(tables.first()).toContainText("helper");
    await expect(tables.nth(1)).toContainText("main");
  });

  test("23: program output grows step 1 to 4", async ({ page }) => {
    await setupWithMock(page, createFrameStdoutNDJSON());

    await goToStep(page, 1);
    const box = page.getByTestId("program-output");
    await expect(box).toBeVisible();
    const early = await box.innerText();
    expect(early).toContain("a");
    expect(early).not.toContain("c");

    await goToStep(page, 4);
    const late = await box.innerText();
    expect(late.length).toBeGreaterThan(early.length);
    expect(late).toContain("c");
  });

  test("24: two-arrow gutter glyphs visible at nested step", async ({ page }) => {
    await setupWithMock(page, createFrameStdoutNDJSON());
    await goToStep(page, 4);

    await expect(page.getByTestId("gutter-prev")).toBeVisible();
    await expect(page.getByTestId("gutter-next")).toBeVisible();
  });

  test("25: legacy trace without frames/stdout renders old flat UI", async ({ page }) => {    await setupWithMock(page, createMockNDJSON());

    await expect(page.getByText("Variables", { exact: true })).toBeVisible();
    await expect(page.getByTestId("frame-table")).toHaveCount(0);
    await expect(page.getByTestId("program-output")).toHaveCount(0);
    await expect(page.getByTestId("gutter-prev")).toHaveCount(0);
    await expect(page.getByTestId("gutter-next")).toHaveCount(0);
    await expect(page.locator('input[aria-label="Trace step"]')).toBeVisible();
  });

  test("26: exit event maps next-arrow to return_line call site", async ({ page }) => {
    await setupWithMock(page, createFrameStdoutNDJSON());
    await goToStep(page, 5);

    await expect(page.getByTestId("gutter-next")).toHaveText("▶ line 3");
    await expect(page.getByTestId("gutter-prev")).toHaveText("◀ line 5");
  });
});
