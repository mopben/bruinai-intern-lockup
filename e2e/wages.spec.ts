/**
 * Each worker can have their own wage in Prices and costs; the profit basis
 * (wages per hour) follows at once, and "Use usual" puts a worker back on the
 * usual wage.
 */
import { expectStep, openStage } from "./support/stage";
import { expect, test } from "./support/fixtures";

test("an individual worker's wage changes the wages in the profit", async ({ page }) => {
  await openStage(page, { step: 2 });
  await expectStep(page, "play");
  await page.getByTestId("btn-costs").click();
  const drawer = page.getByTestId("costs-section");
  await expect(drawer).toBeVisible();

  const rows = drawer.locator('[data-testid^="worker-wage-row-"]');
  await expect(rows).toHaveCount(3);
  await page.getByTestId("cost-wage").fill("20");
  await page.getByTestId("cost-wage").press("Enter");
  await expect(page.getByTestId("profit-basis")).toContainText("$60 wages");

  const first = page.getByTestId("cost-wage-red");
  await first.fill("35");
  await first.press("Enter");
  await expect(page.getByTestId("profit-basis")).toContainText("$75 wages");
  await page.screenshot({ path: "test-results/wages.png" });

  // The usual wage no longer moves red.
  await page.getByTestId("cost-wage").fill("10");
  await page.getByTestId("cost-wage").press("Enter");
  await expect(page.getByTestId("profit-basis")).toContainText("$55 wages");

  await page.getByTestId("btn-usual-wage-red").click();
  await expect(page.getByTestId("profit-basis")).toContainText("$30 wages");
  await expect(first).toHaveValue("10");
});
