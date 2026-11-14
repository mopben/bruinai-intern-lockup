/**
 * Rule 9 (survives the stage), hardening: a projector that changes resolution
 * mid-demo, entering fullscreen, or the GPU dropping the WebGL context must
 * never leave a blank kitchen. Every scene redraws at once.
 */
import type { Page } from "@playwright/test";
import { drawnShare } from "./support/pixels";
import { expectStep, openStage, waitForSession } from "./support/stage";
import { expect, test } from "./support/fixtures";

/** A drawn kitchen covers well over this share of its view; an empty table is ~0. */
const DRAWN = 0.3;

/** Two animation frames after the call, the view must already show the kitchen (one screenshot, no retries). */
async function expectDrawn(page: Page, selector: string): Promise<void> {
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  expect(await drawnShare(page, page.locator(selector).first()), `${selector} drawn`).toBeGreaterThan(DRAWN);
}

async function renders(page: Page, name: string): Promise<number> {
  return page.evaluate((n) => {
    const h = (globalThis as unknown as { __dryrun: { main(): { renders: number } | null; scene(n: string): { renders: number } | null } }).__dryrun;
    return (n === "main" ? h.main() : h.scene(n))?.renders ?? 0;
  }, name);
}

test("rule 9: Run and the simulated Test redraw at once after resizes (projector mode change)", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await openStage(page, { speed: 2, step: 2 });
  await expectStep(page, "run");
  await waitForSession(page, "first", "running");
  await expectDrawn(page, '[data-testid="kitchen-scene"] canvas');
  for (const size of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }, { width: 1024, height: 768 }]) {
    await page.setViewportSize(size);
    await expectDrawn(page, '[data-testid="kitchen-scene"] canvas');
    const d = await page.evaluate(() => (globalThis as unknown as { __dryrun: { main(): { bufferWidth: number; width: number } } }).__dryrun.main());
    expect(d.bufferWidth, "drawing buffer follows the new size").toBe(d.width);
  }

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.keyboard.press("5");
  await expectStep(page, "test");
  await expectDrawn(page, '[data-testid="compare-before"] canvas');
  await expectDrawn(page, '[data-testid="compare-after"] canvas');
  for (const size of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }, { width: 1024, height: 768 }, { width: 1600, height: 900 }]) {
    await page.setViewportSize(size);
    await expectDrawn(page, '[data-testid="compare-before"] canvas');
    await expectDrawn(page, '[data-testid="compare-after"] canvas');
  }
});

test("rule 9: fullscreen, a hidden tab and a lost WebGL context all redraw", async ({ page }) => {
  await openStage(page, { speed: 4, step: 4 });
  await expectStep(page, "play");
  await expectDrawn(page, '[data-testid="kitchen-scene"] canvas');

  // Tab hidden then visible again: the scene draws a fresh frame (the scene is idle otherwise).
  await page.evaluate(() => new Promise((done) => setTimeout(done, 300)));
  const before = await renders(page, "main");
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => renders(page, "main"), { timeout: 1000 }).toBeGreaterThan(before);
  await expectDrawn(page, '[data-testid="kitchen-scene"] canvas');

  // Lose and restore the WebGL context, as a GPU reset or driver hiccup does.
  await page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="kitchen-scene"] canvas') as HTMLCanvasElement;
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    const ext = gl?.getExtension("WEBGL_lose_context");
    if (!ext) throw new Error("no WEBGL_lose_context");
    (globalThis as unknown as { __lose: unknown }).__lose = ext;
    ext.loseContext();
  });
  await expect.poll(async () => (await page.evaluate(() => (globalThis as unknown as { __dryrun: { main(): { contextLost: number } } }).__dryrun.main().contextLost))).toBe(1);
  await page.evaluate(() => (globalThis as unknown as { __lose: { restoreContext(): void } }).__lose.restoreContext());
  await expect.poll(async () => (await page.evaluate(() => (globalThis as unknown as { __dryrun: { main(): { contextRestored: number } } }).__dryrun.main().contextRestored))).toBe(1);
  await expectDrawn(page, '[data-testid="kitchen-scene"] canvas');
  // Still interactive: the rehearsed change still answers.
  const walk = await page.getByTestId("walking-per-order").innerText();
  await page.keyboard.press("m");
  await expect(page.getByTestId("walking-per-order")).not.toHaveText(walk);

  // Fullscreen key (Shift+F): the page goes full screen (or says why not) and the scene still draws.
  await page.keyboard.press("Shift+F");
  await expect
    .poll(async () => (await page.evaluate(() => document.fullscreenElement !== null)) || (await page.getByTestId("notice").filter({ hasText: "full screen" }).count()) > 0)
    .toBe(true);
  await expectDrawn(page, '[data-testid="kitchen-scene"] canvas');
});
