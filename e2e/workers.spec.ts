import { test, expect } from "./support/fixtures";
import { goView, openStage } from "./support/stage";

test("Edit lists current workers and saves each salary independently", async ({ page }) => {
  await openStage(page);
  await goView(page, "play");
  await expect(page.getByTestId("profit-per-hour")).toHaveCount(0);
  await expect(page.getByTestId("btn-rehearsed-m")).toHaveCount(0);
  await expect(page.getByTestId("workers-section")).toHaveCount(0);
  await page.getByTestId("btn-workers").click();
  const salaries = page.locator('[data-testid^="worker-salary-"]');
  await expect(salaries).toHaveCount(3);
  const otherSalary = await salaries.nth(1).inputValue();
  const firstId = await salaries.first().getAttribute("data-testid");
  await salaries.first().fill("27.50");
  await salaries.first().blur();
  await expect(salaries.first()).toHaveValue("27.5");
  await expect(salaries.nth(1)).toHaveValue(otherSalary);
  await page.reload();
  await goView(page, "play");
  await page.getByTestId("btn-workers").click();
  await expect(page.getByTestId(firstId!)).toHaveValue("27.5");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("workers-section")).toHaveCount(0);
});
