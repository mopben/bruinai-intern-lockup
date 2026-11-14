/**
 * Changing a price or cost updates profit per hour as it is typed, and the
 * suggestions on show are searched again with the new numbers.
 */
import { expectStep, openStage, text } from "./support/stage";
import { expect, test } from "./support/fixtures";

test("changing the costs updates profit at once and searches the suggestions again", async ({ page }) => {
  test.setTimeout(180_000);
  await openStage(page, { step: 2 });
  await expectStep(page, "play");

  await page.getByTestId("btn-suggest").click();
  const result = page.getByTestId("suggest-result");
  await expect(result).toBeVisible({ timeout: 90_000 });
  const ideas0 = await page.locator(".st-idea-list").innerText();

  await page.getByTestId("btn-costs").click();
  const profit0 = await text(page, "profit-per-hour");
  // Typed, not yet confirmed: profit already follows.
  await page.getByTestId("cost-demand").fill("30");
  await expect(page.getByTestId("profit-per-hour")).not.toHaveText(profit0);
  await expect(page.getByTestId("profit-basis")).toContainText("Sells all 30 orders");

  // The list is searched again rather than dropped.
  await expect(page.getByTestId("btn-suggest")).toContainText("Stop");
  await expect(result).toBeVisible({ timeout: 90_000 });
  await expect(page.locator(".st-idea-list")).not.toHaveText(ideas0);
  test.info().annotations.push({ type: "ideas", description: `${ideas0.replace(/\s+/g, " ")} -> ${(await page.locator(".st-idea-list").innerText()).replace(/\s+/g, " ")}` });
});
