/**
 * The live paths, with simulated devices, on a server of their own (LIVE_PORT),
 * one test at a time (the relay sends every message to every client).
 *
 * Rule 9: a failed live input hands over to the recording without a reload,
 * and only when the recording is of the same kitchen. The tablet and camera
 * path end to end, saved in fixture format. The phone scan by upload and drop.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { connectCamera, listRecordings, newEntries, newRecordings, removeRecording, validateRecording } from "./support/devices";
import { LIVE_PORT, origin } from "./support/ports";
import { clockSeconds, expectStep, hook, mainDebug, openStage, session, text, waitForSession } from "./support/stage";
import { FIXTURES, loadFixture } from "./support/truth";
import { expect, test } from "./support/fixtures";

const SCAN_TEXT = readFileSync(join(FIXTURES, "counter-a", "scan.json"), "utf8");

async function setSources(page: Page, want: Partial<Record<"scan" | "taps" | "positions", "live" | "replay">>): Promise<void> {
  await page.keyboard.press("i");
  await expect(page.getByTestId("inputs-drawer")).toBeVisible();
  for (const [input, source] of Object.entries(want)) {
    await page.getByTestId(`source-${input}-${source}`).click();
    await expect(page.getByTestId(`chip-source-${input}`)).toHaveAttribute("data-source", source);
  }
  await page.keyboard.press("Escape");
}

// Every live run is saved; none of them may stay behind.
let existing: string[] = [];
test.beforeEach(() => {
  existing = listRecordings(LIVE_PORT);
});
test.afterEach(() => {
  for (const id of newEntries(LIVE_PORT, existing)) removeRecording(LIVE_PORT, id);
});

interface FirstRun {
  readonly origin: string;
  readonly replaced: readonly string[];
  readonly savedId: string | null;
}

test("rule 9: live with no tablet and no camera falls back to the recording, survives a dropped link, and the demo completes", async ({ page }) => {
  // The stage's socket goes through the test, so the test can cut it.
  const cut: (() => void)[] = [];
  let linkDown = false;
  await page.routeWebSocket(/\/ws/, (ws) => {
    if (linkDown) return ws.close();
    const server = ws.connectToServer();
    cut.push(() => (ws.close(), server.close()));
  });
  await openStage(page, { port: LIVE_PORT, mode: "live", speed: 32 });
  await expect(page.getByText(/waiting for the phone/i).first()).toBeVisible();
  await setSources(page, { scan: "replay" });
  await expectStep(page, "scan");

  await page.keyboard.press("ArrowRight");
  await expectStep(page, "run");
  await waitForSession(page, "first", "idle");
  await page.keyboard.press("p");
  await waitForSession(page, "first", "running");
  // No tablet for 5 s: the recorded taps take over; no camera for 4 s: the recorded positions.
  await expect(page.getByTestId("notice").filter({ hasText: "Showing the recorded taps" })).toBeVisible({ timeout: 12_000 });
  await expect(page.getByTestId("chip-source-positions")).toHaveAttribute("data-source", "replay", { timeout: 12_000 });
  const t1 = clockSeconds(await text(page, "run-clock"));

  // The link to the server drops mid-run: the run goes on.
  linkDown = true;
  cut.forEach((c) => c());
  await expect.poll(async () => clockSeconds(await text(page, "run-clock")), { timeout: 10_000 }).toBeGreaterThan(t1 + 2);
  await expect.poll(async () => (await session(page))?.done ?? 0, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
  expect((await session(page))?.status).toBe("running");
  expect((await mainDebug(page)).workers.length).toBe(3);

  // End it; the numbers say plainly that they are partly from the recording.
  await page.keyboard.press("e");
  await waitForSession(page, "first", "ended");
  const first = await hook<FirstRun>(page, "firstRun");
  expect(first.origin).toBe("live");
  expect([...first.replaced].sort()).toEqual(["positions", "taps"]);
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("partly-recorded")).toBeVisible();
  await expect(page.getByTestId("numbers-basis")).toContainText("partly from the recording");

  // The failed inputs stay on the recording: P replays it at the stage speed, and the demo completes.
  await page.keyboard.press("2");
  await page.keyboard.press("p");
  await waitForSession(page, "first", "ended", 30_000);
  await page.keyboard.press("3");
  await expect(page.getByTestId("trust-error")).toHaveText(/^\d+%$/);
  await page.keyboard.press("4");
  await page.keyboard.press("m");
  await page.keyboard.press("5");
  await waitForSession(page, "second", "ended", 30_000);
  await expect(page.getByTestId("verdict")).toBeVisible();
  await page.keyboard.press("6");
  await expect(page.getByTestId("compare-after-time")).toHaveText(/\d+ s$/);
});

test("live path: tablet taps and camera positions drive the run, the run is saved as a valid recording, and Trust works on it", async ({ page, browser, guard }) => {
  test.setTimeout(150_000);
  const before = listRecordings(LIVE_PORT);
  await openStage(page, { port: LIVE_PORT, speed: 1 });
  await setSources(page, { taps: "live", positions: "live" });

  const tabletContext = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  await guard.watch(tabletContext);
  const tablet = await tabletContext.newPage();
  await tablet.goto(`${origin(LIVE_PORT)}/tablet`);
  const camera = await connectCamera(LIVE_PORT);
  const positions = loadFixture("counter-a").positions;
  try {
    await expect.poll(async () => page.getByTestId("btn-inputs").innerText()).toContain("1 tablet, 1 camera");
    await page.keyboard.press("2");
    await waitForSession(page, "first", "idle");
    await page.keyboard.press("p");
    camera.play(positions);
    await waitForSession(page, "first", "running");

    let sawTickets = 0;
    let sawDots = 0;
    // The people at the counter: tap each ticket as soon as it is on the tablet.
    while ((await session(page))?.status === "running") {
      const button = tablet.locator(".ticket-button:enabled").first();
      if ((await button.count()) > 0) await button.click({ timeout: 2000 }).catch(() => undefined);
      else await tablet.locator(".ticket-button:enabled").first().waitFor({ timeout: 1500 }).catch(() => undefined);
      const d = await mainDebug(page);
      sawTickets = Math.max(sawTickets, Object.values(d.queues).reduce((a, b) => a + b, 0));
      sawDots = Math.max(sawDots, d.workers.length);
    }
    expect(sawTickets, "tickets on the stage from tablet orders").toBeGreaterThan(0);
    expect(sawDots, "dots on the stage from the camera").toBe(3);
    expect(camera.sent()).toBeGreaterThan(100);
    await expect(page.getByTestId("orders-done")).toHaveText("10 of 10 orders done");
    await expect(tablet.getByText("Run over").first()).toBeVisible();

    // Saved in fixture format, and valid by the validator the team uses.
    await expect(page.getByTestId("saved-where")).toContainText("recordings/", { timeout: 15_000 });
    const first = await hook<FirstRun>(page, "firstRun");
    expect(first.origin).toBe("live");
    expect(first.replaced).toEqual([]);
    const saved = newRecordings(LIVE_PORT, before);
    expect(saved).toHaveLength(1);
    expect(first.savedId).toBe(saved[0]);
    const check = validateRecording(LIVE_PORT, saved[0]!);
    expect(check.ok, check.report).toBe(true);

    // Trust on what the room just did.
    await page.keyboard.press("ArrowRight");
    await expectStep(page, "trust");
    await expect(page.getByTestId("numbers-basis")).toHaveText("Numbers from the run just made in this room.");
    await expect(page.getByTestId("trust-error").or(page.locator(".st-card .st-warn"))).toBeVisible();
  } finally {
    camera.close();
    await tabletContext.close();
    for (const id of newRecordings(LIVE_PORT, before)) removeRecording(LIVE_PORT, id);
  }
});

test("scan: a scan posted to /api/scan, and a dropped scan.json, reveal with a starter setup; a failed live run on it saves a valid recording", async ({ page, request }) => {
  const before = listRecordings(LIVE_PORT);
  try {
    await openStage(page, { port: LIVE_PORT, mode: "live" });
    await expect(page.getByText(/waiting for the phone/i).first()).toBeVisible();
    const res = await request.post(`${origin(LIVE_PORT)}/api/scan`, { data: JSON.parse(SCAN_TEXT) });
    expect(res.ok()).toBe(true);
    await expect(page.locator(".dr-tag:not(.mode-scan)").first()).toBeVisible({ timeout: 10_000 });
    await expectStep(page, "scan");
    // Boxes rise with scanner labels, then the starter setup's names.
    await expect.poll(() => page.locator(".dr-tag:not(.mode-scan):not(.hidden)").count(), { timeout: 10_000 }).toBeGreaterThanOrEqual(5);
    await expect(page.getByTestId("item-panel").or(page.locator(".st-rail"))).toBeVisible();

    // A live run on the phone's kitchen with no tablet or camera: no recording of this kitchen stands by,
    // so nothing is spliced in; ended by hand, it saves only what was observed, and it validates.
    await page.keyboard.press("ArrowRight");
    await waitForSession(page, "first", "idle");
    await expect(page.getByTestId("notice").filter({ hasText: "No recording of this kitchen is standing by" })).toBeVisible();
    await page.keyboard.press("p");
    await waitForSession(page, "first", "running");
    await expect.poll(async () => (await session(page))?.t ?? 0).toBeGreaterThan(2);
    await page.keyboard.press("e");
    await waitForSession(page, "first", "ended");
    await expect(page.getByTestId("saved-where")).toBeVisible({ timeout: 15_000 });
    const first = await hook<FirstRun>(page, "firstRun");
    expect(first.replaced).toEqual([]);
    const saved = newRecordings(LIVE_PORT, before);
    expect(saved).toHaveLength(1);
    const check = validateRecording(LIVE_PORT, saved[0]!);
    expect(check.ok, check.report).toBe(true);

    // A dropped file works the same way.
    await openStage(page, { port: LIVE_PORT, mode: "live" });
    await expect(page.getByText(/waiting for the phone/i).first()).toBeVisible();
    await page.evaluate((text) => {
      const dt = new DataTransfer();
      dt.items.add(new File([text], "scan.json", { type: "application/json" }));
      window.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, SCAN_TEXT);
    await expect(page.locator(".dr-tag:not(.mode-scan)").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("chip-source-scan")).toHaveAttribute("data-source", "live");
  } finally {
    for (const id of newRecordings(LIVE_PORT, before)) removeRecording(LIVE_PORT, id);
  }
});

test("P follows the inputs: a prepared live run switched to recorded plays the recording", async ({ page }) => {
  await openStage(page, { port: LIVE_PORT, speed: 32 });
  await setSources(page, { taps: "live", positions: "live" });
  await page.keyboard.press("2");
  await waitForSession(page, "first", "idle");
  await setSources(page, { taps: "replay", positions: "replay" });
  await expect(page.getByTestId("notice").filter({ hasText: "standing by" })).toHaveCount(0);
  await page.keyboard.press("p");
  await expect.poll(async () => (await session(page))?.replay).toBe(true);
  await waitForSession(page, "first", "ended");
});

test("Test after a failover gives no verdict; with no matching recording nothing is spliced in", async ({ page }) => {
  await openStage(page, { port: LIVE_PORT, speed: 32, step: 4 });
  await page.keyboard.press("m");
  await page.keyboard.press("ArrowRight");
  await waitForSession(page, "second", "ended");

  // The same change, run live; no tablet and no camera, so both inputs fail over to the matching recording.
  await setSources(page, { taps: "live", positions: "live" });
  await page.keyboard.press("p");
  await waitForSession(page, "second", "idle");
  await page.keyboard.press("p");
  await waitForSession(page, "second", "running");
  await expect(page.getByTestId("chip-source-taps")).toHaveAttribute("data-source", "replay", { timeout: 12_000 });
  await page.keyboard.press("e");
  await waitForSession(page, "second", "ended");
  await expect(page.getByText("Part of this run came from a recording")).toBeVisible();
  await expect(page.getByTestId("verdict")).toHaveCount(0);

  // A change with no recording: the base run never stands in, so no "before" run is passed off as the "after".
  await page.keyboard.press("4");
  await page.keyboard.press("Backspace");
  await page.getByTestId(/btn-add-worker-61A93A22/).click();
  await setSources(page, { taps: "live", positions: "live" });
  await page.keyboard.press("5");
  await waitForSession(page, "second", "idle");
  await page.keyboard.press("p");
  await waitForSession(page, "second", "running");
  await expect(page.getByTestId("notice").filter({ hasText: "No tablet is connected" })).toBeVisible({ timeout: 12_000 });
  expect((await hook<{ taps: string }>(page, "sources")).taps).toBe("live");
  await page.keyboard.press("e");
  await waitForSession(page, "second", "ended");
  await expect(page.getByTestId("verdict")).toHaveCount(0);
  await expect(page.getByTestId("measured-result")).toHaveCount(0);
});
