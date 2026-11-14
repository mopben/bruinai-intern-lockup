import { test, expect } from "./support/fixtures";
import { BOX, chooseLibraryEntry, renameLibraryEntry, mainDebug, clearShiftOrders, openStage, sceneDebug } from "./support/stage";

test("an empty shift explains missing predictions and recovers when orders are added", async ({ page }) => {
  await openStage(page);
  await page.getByTestId("step-orders").click();
  await chooseLibraryEntry(page, "shift", "__create_shift__");
  await clearShiftOrders(page);
  await page.getByTestId("step-results").click();
  for (const side of ["before", "after"]) {
    await expect(page.getByTestId(`compare-${side}-sales`)).toHaveText("$0.00");
  }
  await expect(page.getByTestId("compare-scenarios")).not.toContainText("NaN");
  await page.getByTestId("view-run").click();
  await expect(page.getByTestId("compare-before-sales")).toHaveText("$0.00");
  await page.getByTestId("step-orders").click();
  await page.getByTestId("recipe-latte").locator("summary").click();
  await page.getByTestId("recipe-latte").getByLabel("Quantity in simulation").fill("3");
  await page.getByTestId("step-results").click();
  await page.getByTestId("btn-play").click();
  await expect(page.getByTestId("compare-before-time")).toHaveText(/s$/);
  await page.getByTestId("btn-skip").click();
  await expect(page.getByTestId("compare-before-done")).toHaveText("3 of 3");
});

test("Run offers only comparison and a single simulated scenario", async ({ page }) => {
  await openStage(page);
  await page.getByTestId("step-orders").click();
  await chooseLibraryEntry(page, "shift", "__create_shift__");
  await clearShiftOrders(page);
  await page.getByTestId("recipe-latte").locator("summary").click();
  await page.getByTestId("recipe-latte").getByLabel("Quantity in simulation").fill("3");
  await page.getByTestId("step-results").click();
  await expect(page.getByRole("navigation", { name: "Results views" }).locator("button")).toHaveText(["Compare scenarios", "Run scenario"]);
  await page.getByTestId("view-run").click();
  await expect(page.getByTestId("run-scenario")).toBeVisible();
  await expect(page.getByLabel("Scenario shift", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Scenario setup", { exact: true })).toBeVisible();
  await expect(page.getByTestId("scenario-1-shift")).toHaveCount(0);
  await expect(page.getByTestId("compare-after")).toHaveCount(0);
  await page.getByTestId("btn-play").click();
  await expect(page.getByTestId("compare-before-done")).toHaveText(/of 3$/);
  await page.getByTestId("btn-skip").click();
  await expect(page.getByTestId("compare-before-done")).toHaveText("3 of 3");
  await page.keyboard.press("p");
  await expect(page.getByTestId("compare-before-done")).toHaveText("0 of 3");
  await page.keyboard.press("e");
  await expect(page.getByTestId("compare-before-done")).toHaveText("3 of 3");
  await page.reload();
  await expect(page.getByTestId("run-scenario")).toBeVisible();
});

test("requires a setup before importing or editing", async ({ page }) => {
  await openStage(page, { emptyWorkspace: true });
  await expect(page.getByTestId("btn-import")).toHaveCount(0);
  await expect(page.getByTestId("btn-workers")).toHaveCount(0);
  await page.keyboard.press("w");
  await expect(page.getByRole("dialog", { name: "Workers" })).toHaveCount(0);
  await chooseLibraryEntry(page, "setup", "__create_setup__");
  await expect(page.getByTestId("btn-import")).toBeVisible();
  await expect(page.getByTestId("btn-workers")).toBeVisible();
  await page.getByTestId("step-orders").click();
  await expect(page.getByTestId("active-shift")).toBeVisible();
  await expect(page.locator(".st-recipes")).toHaveCount(0);
  await chooseLibraryEntry(page, "shift", "__create_shift__");
  await clearShiftOrders(page);
  await expect(page.locator(".st-recipes")).toBeVisible();
  await expect(page.getByText("Choose an order to customize", { exact: false })).toHaveCount(0);
});

test("allows creating a setup while live mode is waiting for a scan", async ({ page }) => {
  await openStage(page, { mode: "live", emptyWorkspace: true });
  await chooseLibraryEntry(page, "setup", "__create_setup__");
  await expect(page.getByTestId("btn-import")).toBeVisible();
  await page.getByTestId("btn-import").click();
  await page.getByTestId("source-scan-live").click();
  await expect(page.getByTestId("scan-waiting")).toBeVisible();
  await page.getByTestId("btn-close-import").click();
  await chooseLibraryEntry(page, "setup", "__create_setup__");
  await page.getByTestId("active-setup").click();
  await expect(page.locator('[data-testid^="setup-option-"]')).toHaveCount(2);
});

test("compares independent shift/setup pairs and preserves them after reload", async ({ page }) => {
  await openStage(page);
  await renameLibraryEntry(page, "setup", "Baseline");
  const setupA = (await page.getByTestId("active-setup").getAttribute("data-value"))!;
  await chooseLibraryEntry(page, "setup", "__create_setup__");
  await renameLibraryEntry(page, "setup", "Extra staff");
  const setupB = (await page.getByTestId("active-setup").getAttribute("data-value"))!;
  await page.getByTestId("btn-workers").click();
  await page.getByTestId("new-worker-name").fill("Jamie");
  await page.getByTestId("new-worker-station").selectOption(BOX.make);
  await page.getByTestId("new-worker-salary").fill("25");
  await page.getByTestId("btn-add-worker").click();
  await page.getByTestId("btn-close-workers").click();
  await chooseLibraryEntry(page, "setup", setupA);
  await expect.poll(async () => (await mainDebug(page)).workers.length).toBe(3);
  await chooseLibraryEntry(page, "setup", setupB);
  await expect.poll(async () => (await mainDebug(page)).workers.length).toBe(4);

  await page.getByTestId("step-orders").click();
  await chooseLibraryEntry(page, "shift", "__create_shift__");
  await clearShiftOrders(page);
  await renameLibraryEntry(page, "shift", "Morning");
  const shiftA = (await page.getByTestId("active-shift").getAttribute("data-value"))!;
  await page.getByTestId("recipe-latte").locator("summary").click();
  await page.getByTestId("recipe-latte").getByLabel("Quantity in simulation").fill("2");
  await page.getByTestId("orders-rail").getByRole("heading", { name: "Orders", exact: true }).click();
  await chooseLibraryEntry(page, "shift", "__create_shift__");
  await clearShiftOrders(page);
  await renameLibraryEntry(page, "shift", "Evening");
  const shiftB = (await page.getByTestId("active-shift").getAttribute("data-value"))!;
  // Opening state belongs to the recipe card; it stays open when switching shifts.
  const quantity = page.getByTestId("recipe-latte").getByLabel("Quantity in simulation");
  if (!await quantity.isVisible()) await page.getByTestId("recipe-latte").locator("summary").click();
  await quantity.fill("5");
  await page.getByTestId("orders-rail").getByRole("heading", { name: "Orders", exact: true }).click();
  await chooseLibraryEntry(page, "shift", shiftA);
  await expect(page.getByTestId("recipe-latte").locator("summary")).toContainText("2 orders");
  await chooseLibraryEntry(page, "shift", shiftB);
  await expect(page.getByTestId("recipe-latte").locator("summary")).toContainText("5 orders");

  await page.getByTestId("step-results").click();
  await page.getByTestId("scenario-0-shift").selectOption(shiftA);
  await page.getByTestId("scenario-0-setup").selectOption(setupA);
  await page.getByTestId("scenario-1-shift").selectOption(shiftB);
  await page.getByTestId("scenario-1-setup").selectOption(setupB);
  await expect(page.getByTestId("compare-before")).toContainText("Morning + Baseline");
  await expect(page.getByTestId("compare-after")).toContainText("Evening + Extra staff");
  await page.getByTestId("btn-play").click();
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
  await expect(page.getByTestId("compare-before-profit")).toBeVisible();
  await expect(page.getByTestId("compare-before-done")).toHaveText("0 of 2");
  await expect(page.getByTestId("compare-after-profit")).toBeVisible();
});
