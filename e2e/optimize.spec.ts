import { expect, test } from "./support/fixtures";
import { BOX, goView, openStage } from "./support/stage";

type Placements = Record<string, { x: number; z: number; yaw: number }>;
interface Shown {
  readonly placements: Placements;
  readonly workers: readonly { id: string; stationId: string }[];
}
const shown = (page: import("@playwright/test").Page) =>
  page.evaluate(() => (globalThis as unknown as { __dryrun: { playLayout(): unknown } }).__dryrun.playLayout()) as Promise<Shown>;

test("Optimize finds a more profitable kitchen without touching locked equipment, and can be undone", async ({ page }) => {
  test.setTimeout(180_000);
  await openStage(page);
  await goView(page, "play");
  const before = await shown(page);
  await page.keyboard.press("a");
  await expect(page.getByTestId("btn-optimize")).toContainText("Stop");
  const plan = page.getByTestId("optimize-result");
  await expect(plan).toBeVisible({ timeout: 120_000 });
  await expect(plan).toContainText("Most profitable kitchen found");
  await expect(page.getByTestId("plan-profit")).toContainText("→");
  await expect(page.getByTestId("plan-steps").locator("li").first()).toContainText("Move");
  // Nothing is on the board until the owner asks for it.
  expect(await shown(page)).toEqual(before);
  if (process.env.DRYRUN_SHOT) await page.screenshot({ path: `${process.env.DRYRUN_SHOT}/optimize-plan.png` });

  await page.getByTestId("btn-apply-plan").click();
  await expect(page.getByTestId("btn-apply-plan")).toHaveText("Showing");
  const after = await shown(page);
  expect(Object.keys(after.placements).sort()).toEqual(Object.keys(before.placements).sort());
  expect(after.placements[BOX.make]).toEqual(before.placements[BOX.make]); // locked
  expect(after.placements).not.toEqual(before.placements);
  expect(after.workers.length).toBe(Number((await page.getByTestId("plan-workers").locator(".now").innerText()).trim()));
  if (process.env.DRYRUN_SHOT) await page.screenshot({ path: `${process.env.DRYRUN_SHOT}/optimize-applied.png` });

  await page.getByTestId("btn-undo-plan").click();
  expect(await shown(page)).toEqual(before);
  await expect(page.getByTestId("btn-apply-plan")).toHaveText("Apply");
});

test("Adding equipment by hand clears the answer, so the owner optimizes again", async ({ page }) => {
  test.setTimeout(180_000);
  await openStage(page);
  await goView(page, "play");
  await page.getByTestId("btn-optimize").click();
  await expect(page.getByTestId("optimize-result")).toBeVisible({ timeout: 120_000 });
  const bounds = (await page.getByTestId("kitchen-scene").boundingBox())!;
  const point = await page.evaluate(() => (globalThis as unknown as { __dryrun: { floorScreen(x: number, z: number): { x: number; y: number } } }).__dryrun.floorScreen(2.5, 1.5));
  await page.mouse.click(bounds.x + point.x, bounds.y + point.y, { button: "right" });
  await page.getByRole("menu", { name: "Add a component" }).getByRole("menuitem", { name: "Sink", exact: true }).click();
  await page.getByTestId("btn-panel-done").click();
  await expect(page.getByTestId("optimize-result")).toHaveCount(0);
  await expect(page.getByTestId("btn-optimize")).toBeEnabled();
});
