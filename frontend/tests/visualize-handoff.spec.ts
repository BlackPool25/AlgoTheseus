import { test, expect, type Page } from "@playwright/test";

/** Monaco virtualizes lines: union the top viewport with the bottom one. */
async function readFullEditor(page: Page): Promise<string> {
  const lines = page.locator(".monaco-editor .view-lines");
  const top = await lines.innerText();
  await page.locator(".monaco-editor").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.waitForTimeout(400);
  const bottom = await lines.innerText();
  return `${top}\n${bottom}`.replace(/\u00a0/g, " ");
}

/**
 * visualize-handoff — /visualize/:slug "Try it" must load a RUNNABLE
 * program (CODE_PRESETS entry, with main) into the editor at /, not the
 * bare cppSnippet fragment and not nothing.
 */
test.describe("visualize handoff", () => {
  test("Try It loads the runnable quick-sort preset into the editor at /", async ({
    page,
  }) => {
    await page.goto("/visualize/quick-sort");

    // Pre-fix this is a bare <Link>; post-fix a <button>. Match either.
    await page
      .locator(
        'a:has-text("interactive AlgoTheseus tool"), button:has-text("interactive AlgoTheseus tool")',
      )
      .first()
      .click();

    await expect(page).toHaveURL("/");

    await expect(page.locator(".monaco-editor")).toBeVisible();
    const editorText = await readFullEditor(page);

    // Runnable preset program (has main + driver), not the bare fragment.
    expect(editorText).toContain("quickSort");
    expect(editorText).toContain("int main()");
    // DEFAULT_CODE is the bsearch program — it must be replaced.
    expect(editorText).not.toContain("bsearch");
  });
});
