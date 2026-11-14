import { join } from "node:path";
import { test, expect } from "./support/fixtures";
import { mainDebug, openStage } from "./support/stage";

test("Build combines import and editing with a centered import menu", async ({ page }) => {
  await openStage(page);
  await expect(page.getByTestId("step-strip").locator("button")).toHaveCount(3);
  await expect(page.getByTestId("step-build")).toHaveAttribute("aria-label", "1: Build");
  await expect(page.getByTestId("step-build")).toHaveAttribute("aria-current", "step");
  await expect(page.getByTestId("step-edit")).toHaveCount(0);
  const importButton = page.getByTestId("btn-import");
  const importBounds = await importButton.boundingBox();
  const workersBounds = await page.getByTestId("btn-workers").boundingBox();
  expect(importBounds!.y).toBeLessThan(workersBounds!.y);
  await importButton.click();
  const menu = page.getByRole("dialog", { name: "Import", exact: true });
  await expect(menu).toBeVisible();
  const bounds = await menu.boundingBox();
  const viewport = page.viewportSize()!;
  expect(bounds!.width).toBeGreaterThan(viewport.width * 0.8);
  expect(bounds!.height).toBeGreaterThan(viewport.height * 0.8);
  expect(Math.abs(bounds!.x + bounds!.width / 2 - viewport.width / 2)).toBeLessThan(2);
  for (const id of ["btn-add-scan", "btn-add-mark", "btn-play", "source-scan-live", "source-taps-live", "source-positions-live", "lan-urls", "select-base", "select-second"]) {
    await expect(menu.getByTestId(id)).toBeAttached();
  }
  const count = (await mainDebug(page)).items.length;
  await menu.getByTestId("btn-add-mark").click();
  await expect.poll(async () => (await mainDebug(page)).items.length).toBe(count + 1);
  await menu.getByTestId("source-taps-live").click();
  await expect(menu.getByTestId("input-taps")).toHaveAttribute("data-source", "live");
  await menu.getByTestId("source-taps-replay").click();
  await menu.getByTestId("btn-close-import").focus();
  await page.keyboard.press("2");
  await expect(page.getByTestId("step-build")).toHaveAttribute("aria-current", "step");
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(importButton).toBeFocused();
  await page.keyboard.press("2");
  await expect(page.getByTestId("step-orders")).toHaveAttribute("aria-current", "step");
  await page.keyboard.press("1");
  await expect(importButton).toBeVisible();
});

test("Import accepts a scan file and preserves waiting and recorded input controls", async ({ page }) => {
  await openStage(page);
  await page.getByTestId("btn-import").click();
  const menu = page.getByTestId("import-menu");
  await menu.getByTestId("source-scan-live").click();
  await expect(menu.getByTestId("scan-waiting")).toBeVisible();
  await expect(menu.getByTestId("btn-add-mark")).toBeDisabled();
  await menu.locator('input[type="file"]').setInputFiles(join(import.meta.dirname, "../fixtures/counter-a/scan.json"));
  await expect(menu.getByTestId("btn-add-mark")).toBeEnabled();
  await expect(menu.getByTestId("scan-waiting")).toHaveCount(0);
  await menu.getByTestId("source-scan-replay").click();
  await expect(menu.getByTestId("input-scan")).toHaveAttribute("data-source", "replay");
  await menu.getByTestId("select-base").selectOption("counter-a");
  await menu.getByTestId("btn-close-import").click();
  await page.getByTestId("btn-workers").click();
  await expect(page.getByRole("dialog", { name: "Workers" })).toBeVisible();
});
