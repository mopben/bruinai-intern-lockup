/**
 * The real work time at each station, in Prices and costs: the rehearsal's own
 * time is shown beside it, and a slower station makes less an hour.
 */
import { BOX, expectStep, openStage, text } from "./support/stage";
import { expect, test } from "./support/fixtures";

test("setting how long the work really takes changes what the kitchen can make", async ({ page }) => {
  await openStage(page, { step: 2 });
  await expectStep(page, "play");
  await page.getByTestId("btn-costs").click();
  const row = page.getByTestId(`work-row-${BOX.make}`);
  await expect(row).toContainText("example (40 s)");
  await expect(row).toContainText(/\d\.\d s in the rehearsal/);

  const basis0 = await text(page, "profit-basis");
  const input = page.getByTestId(`cost-work-${BOX.make}`);
  await input.fill("80");
  await input.press("Enter");
  await expect(row).toContainText("set");
  await expect(page.getByTestId("profit-basis")).not.toHaveText(basis0);
  const made = (s: string) => Number(/Sells (\d+)/.exec(s)?.[1]);
  expect(made(await text(page, "profit-basis"))).toBeLessThan(made(basis0));
  await row.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/work-times.png" });
});
