/**
 * Rule 5 (the prediction can be checked): the prediction is frozen from the
 * original run and is the one After the change
 * compares; it does not move when the second run loads and plays; a change
 * with no matching recording is said plainly and never compared with a run of
 * another layout; Compare always shows the layout in Play now.
 */
import { formatRange } from "../src/core";
import { BOX, editNumbers, expectStep, hook, openStage, waitForSession, type RangeV } from "./support/stage";
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

test("rule 5: the prediction frozen on leaving Play is the one tested, and it never moves", async ({ page }) => {
  await openStage(page, { speed: 16, step: 2 });
  await page.keyboard.press("m");
  await expect(page.getByTestId("btn-rehearsed-m")).toHaveAttribute("aria-pressed", "true");
  const shown = (await editNumbers(page)).time!;
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
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
  // Play again does not change it either.
  await page.keyboard.press("p");
  await waitForSession(page, "second", "ended");
  expect(await hook<Frozen>(page, "frozen")).toEqual(frozenAtLeave);
});

test("rule 5: a change with no recording says so and compares like with like", async ({ page }) => {
  await openStage(page, { speed: 32, step: 2 });
  await page.getByTestId(`btn-add-worker-${BOX.order}`).click();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
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

test("Compare shows the layout in Edit now, not an earlier test's", async ({ page }) => {
  await openStage(page, { speed: 32, step: 2 });
  await page.keyboard.press("m");
  await expect(page.getByTestId("btn-rehearsed-m")).toHaveAttribute("aria-pressed", "true");
  const walkM = (await editNumbers(page)).walking;
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await waitForSession(page, "second", "ended");
  await page.keyboard.press("2");
  await expectStep(page, "play");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("w");
  await expect(page.getByTestId("btn-rehearsed-w")).toHaveAttribute("aria-pressed", "true");
  const { walking: walkW, time: timeW } = await editNumbers(page);
  expect(walkW).not.toBe(walkM);
  await page.keyboard.press("3");
  await expectStep(page, "compare");
  await expect(page.getByTestId("compare-after-walking")).toHaveText(walkW!);
  await expect(page.getByTestId("compare-after-time")).toHaveText(timeW!);
});
