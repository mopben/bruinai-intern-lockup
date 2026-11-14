/**
 * Camera controls on the main scene: the wheel zooms towards the cursor, a
 * left-drag on empty floor pans (the boxes move with the pointer), double-
 * click on empty floor (or the Reset view chip) restores the home frame, and
 * a click on empty floor still deselects.
 */
import { BOX, expectStep, goView, mainDebug, openStage } from "./support/stage";
import { expect, test } from "./support/fixtures";
import type { SceneDebug } from "../src/stage/scene/api";

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** A spot inside the scene as far as possible from every box's screen position. */
async function emptyFloor(page: Parameters<typeof mainDebug>[0], d: SceneDebug): Promise<{ x: number; y: number }> {
  const box = (await page.getByTestId("kitchen-scene").boundingBox())!;
  const spots = [0.15, 0.5, 0.85].flatMap((fx) => [0.15, 0.5, 0.85].map((fy) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy })));
  let best = spots[0]!;
  let bestD = -1;
  for (const s of spots) {
    const m = Math.min(...Object.values(d.screen).map((p) => dist(s, p)));
    if (m > bestD) {
      bestD = m;
      best = s;
    }
  }
  return best;
}

test("pan, zoom and reset on the main scene", async ({ page }) => {
  await openStage(page, { step: 1 });
  await expectStep(page, "scan");
  const d0 = await mainDebug(page);
  const fridge0 = d0.screen[BOX.fridge]!;
  const make0 = d0.screen[BOX.make]!;
  const gap0 = dist(fridge0, make0);

  // Wheel over the scene zooms in: the boxes' spacing grows.
  await page.mouse.move((fridge0.x + make0.x) / 2, (fridge0.y + make0.y) / 2);
  await page.mouse.wheel(0, -600);
  await expect.poll(async () => dist((await mainDebug(page)).screen[BOX.fridge]!, (await mainDebug(page)).screen[BOX.make]!)).toBeGreaterThan(gap0 * 1.2);
  await expect(page.getByTestId("reset-view")).toBeVisible();

  // Left-drag on empty floor pans: every box moves by about the drag delta.
  const d1 = await mainDebug(page);
  const spot = await emptyFloor(page, d1);
  const before = d1.screen;
  await page.mouse.move(spot.x, spot.y);
  await page.mouse.down();
  await page.mouse.move(spot.x + 90, spot.y + 50, { steps: 8 });
  await page.mouse.up();
  const d2 = await mainDebug(page);
  for (const [id, p0] of Object.entries(before)) {
    const p1 = d2.screen[id]!;
    expect(p1.x - p0.x, `${id} moved with the pointer`).toBeCloseTo(90, -1);
    expect(p1.y - p0.y, `${id} moved with the pointer`).toBeCloseTo(50, -1);
  }

  // Double-click on empty floor restores the framed view and hides the chip.
  const d3 = await mainDebug(page);
  const spot2 = await emptyFloor(page, d3);
  await page.mouse.dblclick(spot2.x, spot2.y);
  await expect.poll(async () => (await mainDebug(page)).screen[BOX.fridge]!.x).toBeCloseTo(fridge0.x, 0);
  const d4 = await mainDebug(page);
  expect(d4.screen[BOX.fridge]!.y).toBeCloseTo(fridge0.y, 0);
  expect(d4.screen[BOX.make]!.x).toBeCloseTo(make0.x, 0);
  await expect(page.getByTestId("reset-view")).toHaveCount(0);

  // A click on empty floor still deselects: in Edit, select a box, then click empty floor.
  await goView(page, "play");
  const d5a = await mainDebug(page);
  const fridge = d5a.screen[BOX.fridge]!;
  await page.mouse.click(fridge.x, fridge.y);
  await expect(page.getByTestId("item-panel")).toBeVisible();
  const d5 = await mainDebug(page);
  const spot3 = await emptyFloor(page, d5);
  await page.mouse.click(spot3.x, spot3.y);
  await expect(page.getByTestId("item-panel")).toHaveCount(0);
});
