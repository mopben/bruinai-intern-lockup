import { test, expect } from "./support/fixtures";
import { openStage } from "./support/stage";

test("loads, simulates, and restores the six-hour café demo", async ({ page }) => {
  await openStage(page);
  await page.getByTestId("step-orders").click();
  await page.getByTestId("load-demo-shift").click();
  await expect(page.getByTestId("shift-hours")).toHaveValue("6");
  await expect(page.getByTestId("recipe-latte").locator("summary")).toContainText("180 orders");
  await expect(page.getByTestId("recipe-cappuccino").locator("summary")).toContainText("108 orders");
  await expect(page.getByTestId("recipe-espresso").locator("summary")).toContainText("72 orders");
  await page.getByTestId("step-results").click();
  await expect(page.getByTestId("compare-before-profit")).toHaveText(/\$\d/);
  await expect(page.getByTestId("compare-before-labor")).toHaveText("$324.00");
  await expect(page.getByTestId("compare-before")).not.toContainText("NaN");
  await page.reload();
  await page.getByTestId("step-orders").click();
  await expect(page.getByTestId("shift-hours")).toHaveValue("6");
  await expect(page.getByTestId("recipe-latte").locator("summary")).toContainText("180 orders");
});
