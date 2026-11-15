import { BOX, expectStep, mainDebug, openStage } from "./support/stage";
import { expect, test } from "./support/fixtures";
import type { Page } from "@playwright/test";

async function savedPlacements(page: Page) {
  return page.evaluate(() => {
    const workspace = JSON.parse(localStorage.getItem("dryrun.workspace.v1") ?? "null");
    return workspace?.setups.find((s: { id: string }) => s.id === workspace.activeSetupId)?.kitchen.layout.placements ?? null;
  });
}

test("dragging previews geometry and commits the layout only on drop", async ({ page }) => {
  await openStage(page);
  await expectStep(page, "play");
  await expect.poll(() => savedPlacements(page)).not.toBeNull();
  const savedBefore = await savedPlacements(page);
  const before = await mainDebug(page);
  const fridge = before.screen[BOX.fridge]!;
  const make = before.screen[BOX.make]!;
  const original = before.items.find(i => i.id === BOX.fridge)!;

  await page.mouse.move(fridge.x, fridge.y);
  await page.mouse.down();
  for (let i = 1; i <= 30; i++) {
    const f = (i / 30) * 0.75;
    await page.mouse.move(fridge.x + (make.x - fridge.x) * f, fridge.y + (make.y - fridge.y) * f);
  }
  const preview = (await mainDebug(page)).items.find(i => i.id === BOX.fridge)!;
  expect(Math.hypot(preview.x - original.x, preview.z - original.z)).toBeGreaterThan(0.3);
  expect(await savedPlacements(page)).toEqual(savedBefore);

  await page.mouse.up();
  await expect.poll(async () => (await savedPlacements(page))?.[BOX.fridge]).toMatchObject({ x: preview.x, z: preview.z });
  const dropped = (await mainDebug(page)).items.find(i => i.id === BOX.fridge)!;
  expect([dropped.x, dropped.z]).toEqual([preview.x, preview.z]);

  await page.getByTestId("btn-panel-done").click();
  await page.getByTestId("btn-reset").click();
  await expect.poll(async () => {
    const item = (await mainDebug(page)).items.find(i => i.id === BOX.fridge)!;
    return [item.x, item.z];
  }).toEqual([original.x, original.z]);
});
