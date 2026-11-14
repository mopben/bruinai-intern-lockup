/**
 * The side panel: clicking the active step toggles it, the sash resizes it
 * and snaps it closed, the width survives a reload, and the Build panel's
 * actions add a scan and a floor mark.
 */
import { join } from "node:path";
import { expectStep, openStage } from "./support/stage";
import { FIXTURES } from "./support/truth";
import { expect, test } from "./support/fixtures";

async function panelWidth(page: Parameters<typeof openStage>[0]): Promise<number> {
  return (await page.getByTestId("side-panel").boundingBox())?.width ?? 0;
}

async function dragSash(page: Parameters<typeof openStage>[0], dx: number): Promise<void> {
  const sash = page.locator(".st-sash");
  const box = await sash.boundingBox();
  if (!box) throw new Error("no sash");
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx, cy, { steps: 6 });
  await page.mouse.up();
}

test("clicking the active step toggles the panel; another step opens it", async ({ page }) => {
  await openStage(page, { speed: 32 });
  const panel = page.getByTestId("side-panel");
  await expect(panel).toBeVisible();
  await page.getByTestId("step-build").click();
  await expect(panel).toHaveCount(0);
  await page.getByTestId("step-build").click();
  await expect(panel).toBeVisible();
  await page.getByTestId("step-edit").click();
  await expectStep(page, "play");
  await expect(panel).toBeVisible();
});

test("the sash resizes the panel, snaps it closed, and the width survives a reload", async ({ page }) => {
  await openStage(page, { speed: 32 });
  const panel = page.getByTestId("side-panel");
  const stage = page.locator(".st-stage");
  const before = await panelWidth(page);
  const stageBefore = (await stage.boundingBox())!.width;

  await dragSash(page, 120);
  const widened = await panelWidth(page);
  expect(widened - before).toBeGreaterThan(80);
  expect((await stage.boundingBox())!.width).toBeLessThan(stageBefore - 80);

  await page.reload();
  await page.waitForFunction(() => "__dryrun" in globalThis);
  await expect(panel).toBeVisible();
  expect(Math.abs((await panelWidth(page)) - widened)).toBeLessThan(5);

  await dragSash(page, -1200);
  await expect(panel).toHaveCount(0);
});

test("Build panel actions: add a scan by file and add a floor mark", async ({ page }) => {
  await openStage(page, { port: undefined, mode: "live" });
  await expect(page.getByText(/waiting for the phone/i).first()).toBeVisible();
  await page.locator('.st-panel input[type="file"]').setInputFiles(join(FIXTURES, "counter-a", "scan.json"));
  await expect(page.locator(".dr-tag:not(.mode-scan)").first()).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("btn-add-mark").click();
  await expect(page.getByTestId("item-panel")).toBeVisible();
});
