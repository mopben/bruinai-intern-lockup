import { test, expect } from "./support/fixtures";
import { BOX, mainDebug, openStage, sceneDebug } from "./support/stage";

test("requires a setup before importing or editing", async ({ page }) => {
  await openStage(page, { emptyWorkspace: true });
  await expect(page.getByTestId("btn-import")).toHaveCount(0);
  await expect(page.getByTestId("btn-workers")).toHaveCount(0);
  await page.keyboard.press("w");
  await expect(page.getByRole("dialog", { name: "Workers" })).toHaveCount(0);
  await page.getByTestId("active-setup").selectOption("__create_setup__");
  await expect(page.getByTestId("btn-import")).toBeVisible();
  await expect(page.getByTestId("btn-workers")).toBeVisible();
  await page.getByTestId("step-orders").click();
  await expect(page.getByTestId("create-shift")).toBeVisible();
  await expect(page.locator(".st-recipes")).toHaveCount(0);
  await page.getByTestId("create-shift").click();
  await expect(page.locator(".st-recipes")).toBeVisible();
  await expect(page.getByText("Choose an order to customize", { exact: false })).toHaveCount(0);
});

test("allows creating a setup while live mode is waiting for a scan", async ({ page }) => {
  await openStage(page, { mode: "live", emptyWorkspace: true });
  await page.getByTestId("active-setup").selectOption("__create_setup__");
  await expect(page.getByTestId("btn-import")).toBeVisible();
  await page.getByTestId("btn-import").click();
  await page.getByTestId("source-scan-live").click();
  await expect(page.getByTestId("scan-waiting")).toBeVisible();
  await page.getByTestId("btn-close-import").click();
  await page.getByTestId("active-setup").selectOption("__create_setup__");
  await expect(page.getByTestId("active-setup").locator("option")).toHaveCount(3);
});

test("compares independent shift/setup pairs and preserves them after reload", async ({ page }) => {
  await openStage(page);
  await page.getByTestId("setup-name").fill("Baseline");
  const setupA = await page.getByTestId("active-setup").inputValue();
  await page.getByTestId("active-setup").selectOption("__create_setup__");
  await page.getByTestId("setup-name").fill("Extra staff");
  const setupB = await page.getByTestId("active-setup").inputValue();
  await page.getByTestId("btn-workers").click();
  await page.getByTestId("new-worker-name").fill("Jamie");
  await page.getByTestId("new-worker-station").selectOption(BOX.make);
  await page.getByTestId("new-worker-salary").fill("25");
  await page.getByTestId("btn-add-worker").click();
  await page.getByTestId("btn-close-workers").click();
  await page.getByTestId("active-setup").selectOption(setupA);
  await expect.poll(async () => (await mainDebug(page)).workers.length).toBe(3);
  await page.getByTestId("active-setup").selectOption(setupB);
  await expect.poll(async () => (await mainDebug(page)).workers.length).toBe(4);

  await page.getByTestId("step-orders").click();
  await page.getByTestId("create-shift").click();
  await page.getByTestId("shift-name").fill("Morning");
  const shiftA = await page.getByTestId("active-shift").inputValue();
  await page.getByTestId("recipe-latte").locator("summary").click();
  await page.getByTestId("recipe-latte").getByLabel("Quantity in simulation").fill("2");
  await page.getByTestId("shift-name").click();
  await page.getByTestId("create-shift").click();
  await page.getByTestId("shift-name").fill("Evening");
  const shiftB = await page.getByTestId("active-shift").inputValue();
  // Opening state belongs to the recipe card; it stays open when switching shifts.
  const quantity = page.getByTestId("recipe-latte").getByLabel("Quantity in simulation");
  if (!await quantity.isVisible()) await page.getByTestId("recipe-latte").locator("summary").click();
  await quantity.fill("5");
  await page.getByTestId("shift-name").click();
  await page.getByTestId("active-shift").selectOption(shiftA);
  await expect(page.getByTestId("recipe-latte").locator("summary")).toContainText("2 orders");
  await page.getByTestId("active-shift").selectOption(shiftB);
  await expect(page.getByTestId("recipe-latte").locator("summary")).toContainText("5 orders");

  await page.getByTestId("step-results").click();
  await page.getByTestId("scenario-0-shift").selectOption(shiftA);
  await page.getByTestId("scenario-0-setup").selectOption(setupA);
  await page.getByTestId("scenario-1-shift").selectOption(shiftB);
  await page.getByTestId("scenario-1-setup").selectOption(setupB);
  await expect(page.getByTestId("compare-before")).toContainText("Morning + Baseline");
  await expect(page.getByTestId("compare-after")).toContainText("Evening + Extra staff");
  await expect(page.getByTestId("compare-before-done")).toHaveText(/of 2$/);
  await expect(page.getByTestId("compare-after-done")).toHaveText(/of 5$/);
  await expect.poll(async () => (await sceneDebug(page, "compare-before"))?.workers.length).toBe(3);
  await expect.poll(async () => (await sceneDebug(page, "compare-after"))?.workers.length).toBe(4);
  await expect(page.getByTestId("compare-before-time")).toHaveText(/s$/);
  await page.getByTestId("btn-skip").click();
  await expect(page.getByTestId("compare-before-done")).toHaveText("2 of 2");
  await expect(page.getByTestId("compare-after-done")).toHaveText("5 of 5");
  await page.reload();
  await expect(page.getByTestId("scenario-0-setup")).toHaveValue(setupA);
  await expect(page.getByTestId("scenario-1-shift")).toHaveValue(shiftB);
  await expect(page.getByTestId("compare-before-done")).toHaveText(/of 2$/);
  await expect(page.getByTestId("compare-after-done")).toHaveText(/of 5$/);
});
