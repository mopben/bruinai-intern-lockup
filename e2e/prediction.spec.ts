/**
 * Rule 3 (trust comes before play) and rule 5 (the prediction can be
 * checked): the prediction is frozen on leaving Play and is the one Test
 * compares; it does not move when the second run loads and plays; a change
 * with no matching recording is said plainly and never compared with a run of
 * another layout; Compare always shows the layout in Play now.
 */
import { formatRange } from "../src/core";
import { BOX, expectStep, hook, openStage, text, waitForSession, type RangeV } from "./support/stage";
import { expect, test } from "./support/fixtures";

interface Frozen {
  readonly judge: RangeV | null;
  readonly candidates: Record<string, RangeV | null>;
}
interface Plan {
  readonly matched: boolean;
  readonly candidateId: string | null;
  readonly workers: number;
  readonly judgeWorkers: number;
}

test("rule 3: trust is shown, from a run, before anything can be changed", async ({ page }) => {
  await openStage(page, { speed: 32 });
  await page.keyboard.press("ArrowRight");
  await waitForSession(page, "first", "ended");
  await page.keyboard.press("ArrowRight");
  await expectStep(page, "trust");
  await expect(page.getByTestId("trust-error")).toHaveText(/^\d+%$/);
  await expect(page.getByTestId("numbers-basis")).toContainText("Numbers from the recorded run: Original counter");
  // Trust shows the run as it was: no drag handles in Trust.
  const d = await page.evaluate(() => document.querySelectorAll(".dr-tag.movable").length);
  expect(d).toBe(0);
});

test("rule 5: the prediction frozen on leaving Play is the one tested, and it never moves", async ({ page }) => {
  await openStage(page, { speed: 16, step: 4 });
  await page.keyboard.press("m");
  const shown = await text(page, "prediction-range");
  await page.keyboard.press("ArrowRight");
  await expectStep(page, "test");
  const frozenAtLeave = await hook<Frozen>(page, "frozen");
  expect(formatRange(frozenAtLeave.judge!)).toBe(shown);
  await expect(page.getByTestId("prediction-range")).toHaveText(shown);
  await waitForSession(page, "second", "running");
  await waitForSession(page, "second", "ended");
  await expect(page.getByTestId("verdict")).toBeVisible();
  await expect(page.getByTestId("prediction-range")).toHaveText(shown);
  expect(await hook<Frozen>(page, "frozen")).toEqual(frozenAtLeave);
  const outcome = await hook<{ predicted: RangeV }>(page, "outcome");
  expect(outcome.predicted).toEqual(frozenAtLeave.judge);
  await expect(page.getByTestId("range-meaning")).toHaveText(/^The range is where we expect \d+ runs in 10 to land\.$/);
  // Play again does not change it either.
  await page.keyboard.press("p");
  await waitForSession(page, "second", "ended");
  expect(await hook<Frozen>(page, "frozen")).toEqual(frozenAtLeave);
});

test("rule 5: a change with no recording says so and compares like with like", async ({ page }) => {
  await openStage(page, { speed: 32, step: 4 });
  await page.getByTestId(`btn-add-worker-${BOX.order}`).click();
  await page.keyboard.press("ArrowRight");
  await expectStep(page, "test");
  await expect(page.getByTestId("match-note")).toContainText("No recorded run matches this exact change");
  const plan = await hook<Plan>(page, "testPlan");
  expect(plan.matched).toBe(false);
  expect(plan.candidateId).not.toBeNull();
  // The judge's layout had 4 workers (one more at Order); the run shown and compared is the recorded layout.
  expect(plan.judgeWorkers).toBe(4);
  const frozen = await hook<Frozen>(page, "frozen");
  const forCandidate = frozen.candidates[plan.candidateId as string]!;
  await expect(page.getByTestId("prediction-range")).toHaveText(formatRange(forCandidate));
  await waitForSession(page, "second", "ended");
  const outcome = await hook<{ predicted: RangeV }>(page, "outcome");
  expect(outcome.predicted).toEqual(forCandidate);
});

test("Compare shows the layout in Play now, not an earlier Test's (4 → 6 after a new change)", async ({ page }) => {
  await openStage(page, { speed: 32, step: 4 });
  await page.keyboard.press("m");
  const walkM = await text(page, "walking-per-order");
  await page.keyboard.press("ArrowRight");
  await waitForSession(page, "second", "ended");
  await page.keyboard.press("ArrowLeft");
  await expectStep(page, "play");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("w");
  const walkW = await text(page, "walking-per-order");
  const timeW = await text(page, "time-per-order");
  expect(walkW).not.toBe(walkM);
  await page.keyboard.press("6");
  await expectStep(page, "compare");
  await expect(page.getByTestId("compare-after-walking")).toHaveText(walkW);
  await expect(page.getByTestId("compare-after-time")).toHaveText(timeW);
});
