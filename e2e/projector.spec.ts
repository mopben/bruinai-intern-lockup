/**
 * Rule 7 (readable on a projector) and the operator under pressure: at three
 * projector sizes, at every step, nothing essential is cut off or covered,
 * and the big numbers never wrap. Screenshots go to e2e/screenshots/ for a
 * person to look at.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { checkVisible, lineCount } from "./support/layout";
import { BOX, expectStep, openStage, waitForSession } from "./support/stage";
import { expect, test } from "./support/fixtures";

const SHOTS = join(import.meta.dirname, "screenshots");
const SIZES = [
  { width: 1920, height: 1080 },
  { width: 1280, height: 720 },
  { width: 1024, height: 768 },
] as const;

/** What must be on screen, whole and uncovered, at each step. */
const ESSENTIAL: Record<string, readonly string[]> = {
  scan: [],
  run: ["run-clock", "orders-done", "btn-play", "btn-faster", "btn-skip", "run-story"],
  play: ["walking-per-order", "time-per-order", "prediction-range", "btn-rehearsed-m", "btn-rehearsed-w", "btn-reset", `btn-add-worker-${BOX.make}`],
  test: ["prediction-range", "run-clock", "btn-play", "measured-result", "verdict"],
  compare: ["compare-before-walking", "compare-before-time", "compare-after-walking", "compare-after-time", "compare-clock", "btn-play", "btn-faster"],
};
/** Numbers that must sit on one line. */
const ONE_LINE = ["walking-per-order", "time-per-order", "run-clock", "compare-before-time", "compare-after-time", "compare-before-walking", "compare-after-walking"];

async function checkStep(page: Page, step: string, size: string): Promise<string[]> {
  const problems: string[] = [];
  const ids = ["step-strip", ...STEP_BUTTONS, ...(["run", "test", "compare"].includes(step) ? ["view-compare", "view-run", "view-test"] : []), ...(ESSENTIAL[step] ?? [])];
  for (const id of ids) {
    // The side panel scrolls on small projectors: bring each essential into view, then check it is whole and uncovered.
    await page.evaluate((sel) => document.querySelector(sel)?.scrollIntoView({ block: "nearest" }), `[data-testid="${id}"]`);
    const v = await checkVisible(page, `[data-testid="${id}"]`, id);
    if (!v.ok) problems.push(`${size} ${step}: ${id} ${v.why}`);
  }
  for (const id of ONE_LINE) {
    if ((await page.getByTestId(id).count()) === 0) continue;
    const n = await lineCount(page, `[data-testid="${id}"]`);
    if (n > 1) problems.push(`${size} ${step}: ${id} wraps onto ${n} lines`);
  }
  const hints = await checkVisible(page, ".st-panel .st-hints", "panel hints");
  if (!hints.ok) problems.push(`${size} ${step}: ${hints.why}`);
  return problems;
}

/**
 * Checks once the layout has settled (a result scrolls itself into view, a
 * step pill finishes its little lift): retries for up to 4 s, then keeps
 * whatever problems remain.
 */
async function settled(page: Page, step: string, size: string, problems: string[]): Promise<void> {
  let last: string[] = [];
  await expect
    .poll(async () => (last = await checkStep(page, step, size)).length, { timeout: 4000, intervals: [100, 250, 500] })
    .toBe(0)
    .catch(() => undefined);
  problems.push(...last);
}

const STEP_BUTTONS = ["step-build", "step-edit", "step-results"];

for (const vp of SIZES) {
  const size = `${vp.width}x${vp.height}`;
  test(`projector ${size}: every step fits, nothing essential cut off or covered (rule 7)`, async ({ page }) => {
    mkdirSync(SHOTS, { recursive: true });
    await page.setViewportSize(vp);
    await openStage(page, { speed: 32 });
    const problems: string[] = [];
    const shot = (step: string) => page.screenshot({ path: join(SHOTS, `${size}-${step}.png`) });

    await expect(page.locator(".dr-tag:not(.mode-scan)").filter({ hasText: "Espresso machine" })).toBeVisible();
    await settled(page, "scan", size, problems);
    await shot("1-build");

    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expectStep(page, "run");
    await waitForSession(page, "first", "ended");
    await expect(page.getByTestId("run-story")).toBeVisible();
    await settled(page, "run", size, problems);
    await shot("3-original-run");

    await page.keyboard.press("2");
    await expectStep(page, "play");
    await page.keyboard.press("m");
    await expect(page.getByTestId("walking-per-order-before")).toBeVisible();
    await settled(page, "play", size, problems);
    await shot("2-edit");

    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expectStep(page, "test");
    await waitForSession(page, "second", "ended");
    await expect(page.getByTestId("verdict")).toBeVisible();
    await settled(page, "test", size, problems);
    await shot("3-after-change");

    await page.keyboard.press("3");
    await expectStep(page, "compare");
    await expect(page.getByTestId("compare-after-time")).toBeVisible();
    // Let the two scenes draw a few frames before the picture.
    await page.waitForFunction(() => {
      const h = (globalThis as unknown as { __dryrun: { scene(n: string): { renders: number } | null } }).__dryrun;
      return (h.scene("compare-before")?.renders ?? 0) > 3 && (h.scene("compare-after")?.renders ?? 0) > 3;
    });
    await settled(page, "compare", size, problems);
    await shot("3-before-after");

    expect(problems).toEqual([]);
  });
}
