/**
 * Rule 6, every number is honest: the screen shows exactly what src/core
 * computes from the fixture files, recomputed here at test time; and the
 * stage code holds none of the fixture results as literals.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { computeTruth } from "./support/truth";
import { expectStep, openStage, text, waitForSession } from "./support/stage";
import { expect, test } from "./support/fixtures";

const truth = computeTruth();

test("rule 6: walking, prediction and measured result equal src/core on the fixtures", async ({ page }) => {
  await openStage(page, { speed: 32, step: 2 });
  await expectStep(page, "play");
  await expect(page.getByTestId("walking-per-order")).toHaveText(truth.walkA);
  await expect(page.getByTestId("time-per-order")).toHaveText(truth.timeA);

  // The fridge move: B's layout, predicted from A only.
  await page.keyboard.press("m");
  await expect(page.getByTestId("walking-per-order")).toHaveText(truth.walkB);
  await expect(page.getByTestId("time-per-order")).toHaveText(truth.timeB);
  await expect(page.getByTestId("prediction-range")).toHaveText(truth.timeB);

  // The fourth worker: walking does not change with staffing.
  await page.keyboard.press("Backspace");
  await page.keyboard.press("w");
  await expect(page.getByTestId("walking-per-order")).toHaveText(truth.walkC);
  await page.keyboard.press("Backspace");
  await page.keyboard.press("m");

  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expectStep(page, "test");
  await expect(page.getByTestId("prediction-range")).toHaveText(truth.timeB);
  await waitForSession(page, "second", "ended");
  const headline = await text(page, "measured-result");
  expect(headline).toContain(`Measured ${truth.measuredB.toFixed(1)} s.`);
  expect(headline).toContain(`(${truth.rangeB.p10.toFixed(1)}–${truth.rangeB.p90.toFixed(1)} s before rounding)`);
  const inside = truth.measuredB >= truth.rangeB.p10 && truth.measuredB <= truth.rangeB.p90;
  await expect(page.getByTestId("verdict")).toHaveText(inside ? "Inside the range." : /^Outside the range: /);
  await expect(page.getByTestId("before-after")).toContainText(`Before ${truth.measuredA.toFixed(1)} s → after ${truth.measuredB.toFixed(1)} s`);

  await page.keyboard.press("4");
  await expectStep(page, "compare");
  await expect(page.getByTestId("compare-before-walking")).toHaveText(truth.walkA);
  await expect(page.getByTestId("compare-after-walking")).toHaveText(truth.walkB);
  await expect(page.getByTestId("compare-before-time")).toHaveText(truth.timeA);
  await expect(page.getByTestId("compare-after-time")).toHaveText(truth.timeB);
});

function stageSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return stageSources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

test("rule 6: no fixture result is typed into the stage code", () => {
  const results = [
    truth.walkA,
    truth.walkB,
    truth.walkC,
    `${truth.measuredA.toFixed(1)} s`,
    `${truth.measuredB.toFixed(1)} s`,
    `${truth.rangeB.p10.toFixed(1)}`,
    `${truth.rangeB.p90.toFixed(1)}`,
  ]
    .map((s) => s.replace(/ (m|s)$/, ""))
    .filter((s) => /\d\.\d/.test(s) && s !== "1.0" && s !== "0.0");
  const found: string[] = [];
  for (const file of stageSources(join(import.meta.dirname, "..", "src", "stage"))) {
    const code = readFileSync(file, "utf8").replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "");
    for (const value of results) {
      const re = new RegExp(`(?<![\\d.])${value.replace(".", "\\.")}(?![\\d])`);
      if (re.test(code)) found.push(`${file}: ${value}`);
    }
  }
  expect(found, "fixture results written into stage code").toEqual([]);
});
