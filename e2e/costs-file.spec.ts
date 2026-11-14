/**
 * Prices and costs can be exported to a file and imported back: after going
 * back to the example numbers, importing the exported file restores the
 * owner's numbers and the profit follows.
 */
import { readFileSync } from "node:fs";
import { expectStep, openStage } from "./support/stage";
import { expect, test } from "./support/fixtures";

test("exported prices and costs import back", async ({ page }, info) => {
  await openStage(page, { step: 2 });
  await expectStep(page, "play");
  await page.getByTestId("btn-costs").click();
  await expect(page.getByTestId("costs-section")).toBeVisible();

  await page.getByTestId("cost-wage").fill("20");
  await page.getByTestId("cost-wage").press("Enter");
  await page.getByTestId("cost-wage-red").fill("35");
  await page.getByTestId("cost-wage-red").press("Enter");
  await expect(page.getByTestId("profit-basis")).toContainText("$75 wages");

  const downloading = page.waitForEvent("download");
  await page.getByTestId("btn-export-costs").click();
  const saved = info.outputPath("prices-and-costs.json");
  await (await downloading).saveAs(saved);
  const file = JSON.parse(readFileSync(saved, "utf8")) as { format: string; wagePerHour: number; wageByWorker: Record<string, number> };
  expect(file.format).toBe("dryrun.costs");
  expect(file.wagePerHour).toBe(20);
  expect(file.wageByWorker).toEqual({ red: 35 });

  await page.getByTestId("btn-example-costs").click();
  await expect(page.getByTestId("profit-basis")).not.toContainText("$75 wages");

  await page.getByTestId("input-import-costs").setInputFiles(saved);
  await expect(page.getByTestId("costs-file-message")).toContainText("Loaded prices-and-costs.json");
  await page.getByTestId("costs-file-message").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/costs-file.png" });
  await expect(page.getByTestId("profit-basis")).toContainText("$75 wages");
  await expect(page.getByTestId("cost-wage")).toHaveValue("20");

  await page.getByTestId("input-import-costs").setInputFiles({ name: "junk.json", mimeType: "application/json", buffer: Buffer.from("{}") });
  await expect(page.getByTestId("costs-file-message")).toContainText("not a prices-and-costs file");
  await expect(page.getByTestId("profit-basis")).toContainText("$75 wages");
});
