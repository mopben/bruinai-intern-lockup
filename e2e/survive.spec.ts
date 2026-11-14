/**
 * Rule 9, it survives the stage (replay side): once loaded, the demo needs no
 * server at all; a reload at any step lands somewhere usable; switching an
 * input in Inputs never loses the change; keys that do nothing say so.
 */
import { expectStep, goView, openStage, VIEW_IDS, text, waitForSession } from "./support/stage";
import { REPLAY_PORT, origin } from "./support/ports";
import { expect, test } from "./support/fixtures";

test("rule 9: with the server gone after loading, steps 1 to 3 still complete", async ({ page }) => {
  let serverGone = false;
  const sockets: { close(): void }[] = [];
  await page.routeWebSocket(/\/ws/, (ws) => {
    if (serverGone) return ws.close();
    const server = ws.connectToServer();
    sockets.push({ close: () => (ws.close(), server.close()) });
  });
  await openStage(page, { speed: 32 });
  await expect(page.locator(".dr-tag:not(.mode-scan)").filter({ hasText: "Espresso machine" })).toBeVisible();

  // The laptop server dies: every request fails, the socket drops and cannot come back.
  serverGone = true;
  let refused = 0;
  await page.route(`${origin(REPLAY_PORT)}/**`, (route) => {
    refused += 1;
    return route.abort("connectionrefused");
  });
  sockets.forEach((s) => s.close());

  await goView(page, "run");
  await waitForSession(page, "first", "ended");
  await expect(page.getByTestId("run-story")).toBeVisible();
  await goView(page, "play");
  await page.keyboard.press("m");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expectStep(page, "test");
  await waitForSession(page, "second", "ended");
  await expect(page.getByTestId("verdict")).toBeVisible();
  await expect(page.getByText("Could not load the recorded run")).toHaveCount(0);
  await page.keyboard.press("3");
  await expect(page.getByTestId("compare-after-time")).toHaveText(/\d+ s$/);
  test.info().annotations.push({ type: "offline", description: `${refused} requests to the server refused after it died` });
});

for (const step of VIEW_IDS) {
  test(`rule 9: a reload at view ${step} lands in a usable state`, async ({ page }) => {
    // Get there with the keys, as the operator does; the address remembers the step.
    await openStage(page, { speed: 32 });
    await goView(page, step);
    await expectStep(page, step);
    await page.reload();
    await page.waitForFunction(() => "__dryrun" in globalThis);
    await expectStep(page, step);
    await expect(page.getByText("Loading the kitchen…")).toHaveCount(0);
    await expect(page.getByText("The run did not load")).toHaveCount(0);
    const want: Record<string, string> = {
      scan: "step-strip",
      run: "run-clock",
      play: "profit-per-hour",
      test: "prediction-range",
      compare: "compare-after-walking",
    };
    await expect(page.getByTestId(want[step]!)).toBeVisible();
    if (step === "test") await expect(page.getByTestId("verdict")).toBeVisible({ timeout: 30_000 });
    if (step !== "compare" && step !== "scan") expect((await page.locator(".st-rail").innerText()).trim().length).toBeGreaterThan(40);
  });
}

test("rule 9: switching an input in Inputs keeps the change", async ({ page }) => {
  await openStage(page, { speed: 32, step: 2 });
  await page.keyboard.press("m");
  const walk = await text(page, "profit-basis");
  await page.keyboard.press("1");
  await expect(page.getByTestId("inputs-section")).toBeVisible();
  for (const input of ["positions", "taps"]) {
    await page.getByTestId(`source-${input}-live`).click();
    await expect(page.getByTestId(`input-${input}`)).toHaveAttribute("data-source", "live");
    await page.getByTestId(`source-${input}-replay`).click();
    await expect(page.getByTestId(`input-${input}`)).toHaveAttribute("data-source", "replay");
  }
  await page.keyboard.press("2");
  await expectStep(page, "play");
  await expect(page.getByTestId("profit-basis")).toHaveText(walk);
});

test("keys that do nothing here say so, and steps entered early explain themselves", async ({ page }) => {
  await openStage(page, { speed: 32, step: 1 });
  await page.keyboard.press("m");
  await expect(page.getByTestId("notice")).toContainText("Edit (step 2)");
  await page.keyboard.press("e");
  await expect(page.getByTestId("notice")).toContainText("E skips to the end");
  await page.keyboard.press("1");
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByTestId("notice")).toContainText("This is the first step");
  // Every step, opened directly, shows words, never a blank panel.
  for (const step of VIEW_IDS) {
    await goView(page, step);
    await expectStep(page, step);
    if (step === "compare") await expect(page.getByTestId("compare-before-walking")).toBeVisible();
    else expect((await page.locator(".st-rail").innerText()).trim().length).toBeGreaterThan(20);
  }
});
