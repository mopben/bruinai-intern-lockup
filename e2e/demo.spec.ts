/**
 * Definition of done: the whole demo, steps 1 to 3, from fixtures, with the
 * keyboard only (the runbook's keys), at an accelerated replay speed.
 */
import { BOX, STATIONS, clockSeconds, expectStep, mainDebug, openStage, startQueueSampler, stopQueueSampler, text, waitForSession } from "./support/stage";
import { expect, test } from "./support/fixtures";

const SPEED = 16;

/** "Predicted 8–10 s (8.8–9.7 s before rounding). Measured 9.9 s." */
function parseHeadline(s: string): { lo: number; hi: number; measured: number } | null {
  const m = /\((\d+(?:\.\d)?)–(\d+(?:\.\d)?) s before rounding\)\. Measured (\d+(?:\.\d)?) s\./.exec(s);
  return m ? { lo: Number(m[1]), hi: Number(m[2]), measured: Number(m[3]) } : null;
}

test("definition of done: full demo, replay, keyboard only (acceptance steps 1-3)", async ({ page }) => {
  await openStage(page, { speed: SPEED });
  const kb = page.keyboard;

  // 1. The scan: boxes rise with scanner labels, then the owner's names.
  await expectStep(page, "scan");
  const tags = page.locator(".dr-tag:not(.mode-scan)");
  await expect(tags.filter({ hasText: "Espresso machine" })).toBeVisible();
  for (const name of ["Order (till)", "Finish", "Milk fridge", "Pickup"]) await expect(tags.filter({ hasText: name })).toBeVisible();

  // 2. The run: dots move, the clock advances, orders complete, Make piles up.
  await startQueueSampler(page);
  await kb.press("ArrowRight");
  await kb.press("ArrowRight");
  await kb.press("ArrowRight");
  await expectStep(page, "run");
  await expect.poll(async () => clockSeconds(await text(page, "run-clock"))).toBeGreaterThan(5);
  await expect.poll(async () => (await mainDebug(page)).workers.length).toBe(3);
  const firstSpot = (await mainDebug(page)).workers.map((w) => `${w.x.toFixed(2)},${w.z.toFixed(2)}`).join(" ");
  await expect.poll(async () => (await mainDebug(page)).workers.map((w) => `${w.x.toFixed(2)},${w.z.toFixed(2)}`).join(" ")).not.toBe(firstSpot);
  await waitForSession(page, "first", "ended");
  const samples = await stopQueueSampler(page);
  await expect(page.getByTestId("orders-done")).toHaveText("10 of 10 orders done");
  await expect(page.getByTestId("run-story")).toContainText("Espresso machine");
  const makeLeads = samples.filter((s) => {
    const make = s.q[BOX.make] ?? 0;
    return make >= 2 && STATIONS.filter((id) => id !== BOX.make).every((id) => (s.q[id] ?? 0) < make);
  });
  expect(makeLeads.length, "frames where the Espresso machine had more tickets than any other station").toBeGreaterThan(samples.length * 0.3);
  // The alert marks the station that truly leads, and only it.
  const alerted = new Set(samples.flatMap((s) => s.a));
  expect([...alerted]).toEqual([BOX.make]);

  // Edit: the rehearsed move changes both numbers; a range with its assumption.
  await kb.press("2");
  await expectStep(page, "play");
  const walkBefore = await text(page, "walking-per-order");
  const timeBefore = await text(page, "time-per-order");
  expect(walkBefore).toMatch(/^\d+\.\d m$/);
  await kb.press("m");
  await expect(page.getByTestId("walking-per-order")).not.toHaveText(walkBefore);
  await expect(page.getByTestId("time-per-order")).not.toHaveText(timeBefore);
  await expect(page.getByTestId("walking-per-order-before")).toHaveText(walkBefore);
  const range = await text(page, "prediction-range");
  expect(range).toMatch(/^(\d+–\d+ s|about \d+ s)$/);

  // After the change: the recorded second run plays with an honest verdict.
  await kb.press("ArrowRight");
  await kb.press("ArrowRight");
  await kb.press("ArrowRight");
  await expectStep(page, "test");
  await expect(page.getByTestId("prediction-range")).toHaveText(range);
  await waitForSession(page, "second", "ended");
  const headline = await text(page, "measured-result");
  const verdict = await text(page, "verdict");
  const parsed = parseHeadline(headline);
  expect(parsed, `headline "${headline}"`).not.toBeNull();
  if (parsed) {
    // Honesty: the verdict agrees with the numbers on screen.
    if (parsed.measured < parsed.lo || parsed.measured > parsed.hi) expect(verdict).toMatch(/outside the range/i);
    else if (parsed.measured > parsed.lo && parsed.measured < parsed.hi) expect(verdict).toBe("Inside the range.");
    if (/outside/i.test(verdict)) expect(verdict).toContain(parsed.measured > parsed.hi ? "slower" : "faster");
  }
  // And with the unrounded frozen range.
  const exact = (await page.evaluate(() => (globalThis as unknown as { __dryrun: { frozenJudge(): unknown } }).__dryrun.frozenJudge())) as { p10: number; p90: number };
  if (parsed) {
    const inside = parsed.measured >= exact.p10 - 0.05 && parsed.measured <= exact.p90 + 0.05;
    if (!inside) expect(verdict).toMatch(/outside/i);
  }

  // Before vs after: two kitchens, both with numbers, the clock advancing.
  await kb.press("4");
  await expectStep(page, "compare");
  for (const side of ["before", "after"]) {
    await expect(page.getByTestId(`compare-${side}`)).toBeVisible();
    await expect(page.getByTestId(`compare-${side}-walking`)).toHaveText(/^\d+\.\d m$/);
    await expect(page.getByTestId(`compare-${side}-time`)).toHaveText(/\d+ s$/);
    await expect(page.getByTestId(`compare-${side}-done`)).toHaveText(/^\d+ of 10$/);
  }
  await expect.poll(async () => clockSeconds(await text(page, "compare-clock"))).toBeGreaterThan(2);
  await expect(page.getByTestId("compare-before-walking")).not.toHaveText(await text(page, "compare-after-walking"));
});
