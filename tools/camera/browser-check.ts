/**
 * Drives the real /camera page in headless Chromium with a synthetic video:
 * loads the kitchen, opens the video, imports the calibration, takes
 * screenshots, turns the whole video into positions.jsonl, and (with a tiny
 * WebSocket listener posing as the stage) checks live reports while playing.
 *
 *   npx tsx tools/camera/browser-check.ts <base-url> <synth-dir> <calibration.json> <out-dir> [operator]
 *
 * With "operator", it also does what the operator does on the day: for each
 * worker, at a moment they stand on their mark, press Measure and click their
 * hat, then press Sample and click it again. The rest of the run then uses
 * those measured heights and sampled colours.
 *
 * Needs the server running (e.g. PORT=5192 npm run serve after a build).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";
import WebSocket from "ws";
import { createLiveFeed } from "../../src/inputs/live-feed";
import { positionReportSchema } from "../../src/inputs/protocol";
import { createReconnectingSocket, type WebSocketLike } from "../../src/inputs/socket";
import { kitchenView } from "../../src/camera/kitchen";
import { cameraMatrix, project } from "../../src/camera/pinhole";
import { at, loadFixture, tracksByWorker } from "./fixture";
import { person, TRUE_POSE } from "./scene";

const [base, synthDir, calibFile, outDir, flow] = process.argv.slice(2);
if (!base || !synthDir || !calibFile || !outDir) {
  process.stderr.write("Usage: browser-check.ts <base-url> <synth-dir> <calibration.json> <out-dir>\n");
  process.exit(1);
}
const say = (s: string) => process.stdout.write(`${s}\n`);

async function main() {
  mkdirSync(outDir!, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") pageErrors.push(m.text());
  });

  // A stand-in stage: counts position reports and checks their shape.
  const wsUrl = base!.replace(/^http/, "ws") + "/ws?role=stage";
  const reports: unknown[] = [];
  const ws = new WebSocket(wsUrl);
  ws.on("message", (raw) => {
    const env = JSON.parse(String(raw)) as { channel: string; payload: unknown };
    if (env.channel === "positions") reports.push(env.payload);
  });
  await new Promise((r) => ws.once("open", r));

  // And the product's own consumer: a live run feed, as the stage uses it.
  const fixture = loadFixture(resolve("fixtures/counter-a"));
  const link = createReconnectingSocket({ url: wsUrl, role: "stage", createSocket: (u) => new WebSocket(u) as unknown as WebSocketLike });
  const feed = createLiveFeed({ link, setup: fixture.kitchen.setup, workers: fixture.kitchen.layout.workers, autoEnd: false });
  const stamped: { t: number; workerId: string }[] = [];
  feed.onPosition((p) => stamped.push({ t: p.t, workerId: p.workerId }));

  await page.goto(`${base}/camera`);
  await page.getByText("Connected to the laptop").waitFor({ timeout: 10000 });
  await page.getByLabel("Load a kitchen from a recorded run").selectOption({ value: "/fixtures/counter-a/" });
  await page.getByText("Kitchen: from recorded run counter-a").waitFor();
  await page.locator('.sourcebar input[type="file"]').setInputFiles(resolve(synthDir!, "camera.webm"));
  await page.getByText("Opened camera.webm").waitFor({ timeout: 20000 });
  await page.screenshot({ path: join(outDir!, "1-opened.png") });

  await page.getByRole("button", { name: "Calibrate" }).click();
  await page.locator('.calib input[type="file"]').setInputFiles(resolve(calibFile!));
  await page.getByText("Calibration loaded").waitFor();
  await page.locator(".calib .next").waitFor();
  say(`calibration panel: ${await page.locator(".calib").innerText()}`);
  await page.screenshot({ path: join(outDir!, "2-calibrated.png") });
  await page.getByRole("button", { name: "Done" }).click();

  if (flow === "operator") await operatorFlow(page);

  // Seek to a moment with everyone in view and look.
  await page.getByLabel("Position in the video").fill("14.2");
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(outDir!, "3-tracking-14s.png") });
  await page.getByLabel("Position in the video").fill("47.1");
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(outDir!, "4-lamp-occludes-blue-47s.png") });

  // Live path: play 1x for 6 s; reports should flow to the "stage".
  await page.getByLabel("Position in the video").fill("20");
  await page.waitForTimeout(300);
  feed.start();
  await page.getByRole("button", { name: "Record" }).click();
  await page.getByRole("button", { name: "Play" }).click();
  await page.waitForTimeout(6000);
  feed.stop();
  await page.getByRole("button", { name: "Pause" }).click();
  const [recDownload] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Stop and save/ }).click()]);
  const recPath = join(outDir!, "recorded-live.jsonl");
  await recDownload.saveAs(recPath);
  const recLines = readFileSync(recPath, "utf8").trim().split("\n");
  say(`record toggle: ${recDownload.suggestedFilename()} with ${recLines.length - 1} samples, header ${recLines[0]}`);
  const bad = reports.filter((r) => !positionReportSchema.safeParse(r).success);
  const perWorker = new Map<string, number>();
  for (const r of reports) for (const s of (r as { samples: { workerId: string }[] }).samples) perWorker.set(s.workerId, (perWorker.get(s.workerId) ?? 0) + 1);
  say(`live: ${reports.length} reports in ~6 s, ${bad.length} malformed, samples per worker ${JSON.stringify(Object.fromEntries(perWorker))}`);
  say(`first report: ${JSON.stringify(reports[0])}`);
  say(`live feed (stage side): ${stamped.length} samples stamped, run time ${stamped[0]?.t.toFixed(2)}..${stamped[stamped.length - 1]?.t.toFixed(2)} s`);
  await page.screenshot({ path: join(outDir!, "5-after-play.png") });

  // Whole file, as fast as possible.
  const started = Date.now();
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 600000 }),
    page.getByRole("button", { name: "Turn whole video into positions.jsonl" }).click(),
  ]);
  const target = join(outDir!, "tracked-positions.jsonl");
  await download.saveAs(target);
  say(`whole file processed in ${((Date.now() - started) / 1000).toFixed(1)} s -> ${target}`);
  await page.screenshot({ path: join(outDir!, "6-done.png") });
  writeFileSync(join(outDir!, "page-errors.txt"), pageErrors.join("\n"));
  say(`page errors: ${pageErrors.length === 0 ? "none" : pageErrors.join(" | ")}`);
  ws.close();
  feed.dispose();
  link.close();
  await browser.close();
}

type Page = Awaited<ReturnType<Awaited<ReturnType<typeof chromium.launch>>["newPage"]>>;

/** Measure and sample each hat the way the operator does, via clicks on the picture. */
async function operatorFlow(page: Page) {
  const run = loadFixture(resolve("fixtures/counter-a"));
  const view = kitchenView(run.kitchen);
  if (!view.ok) throw new Error(view.error);
  const tracks = tracksByWorker(run.samples);
  const P = cameraMatrix(TRUE_POSE);
  const canvas = page.locator(".cam-view canvas");
  for (const [i, w] of run.kitchen.layout.workers.entries()) {
    const stand = view.value.stands[w.id]!;
    const track = tracks.get(w.id) ?? [];
    // The moment they are closest to their mark (arm down), as the operator would wait for.
    let best = { t: 0, d: Infinity };
    for (let t = 0; t < run.duration; t += 0.1) {
      const p = at(track, t);
      if (!p || person(w, i, p, t).armUp) continue;
      const d = Math.hypot(p.x - stand.x, p.z - stand.z);
      if (d < best.d) best = { t: Math.round(t * 10) / 10, d };
    }
    await page.getByLabel("Position in the video").fill(String(best.t));
    await page.waitForTimeout(500);
    const p = person(w, i, at(track, best.t)!, best.t);
    const px = project(P, { x: p.p.x, y: p.hatY, z: p.p.z })!;
    const box = (await canvas.boundingBox())!;
    const click = { x: (px.x / TRUE_POSE.width) * box.width, y: (px.y / TRUE_POSE.height) * box.height };
    const card = page.locator(".worker", { hasText: w.name });
    await card.getByRole("button", { name: "Measure" }).click();
    await canvas.click({ position: click });
    const measured = await page.locator(".notice").innerText();
    await card.getByRole("button", { name: "Sample" }).click();
    await canvas.click({ position: click });
    const sampled = await page.locator(".notice").innerText();
    say(`operator: ${w.name} at t=${best.t} (${(best.d * 100).toFixed(0)} cm from the mark, true hat ${p.hatY} m): "${measured}" / "${sampled}"`);
  }
  await page.screenshot({ path: join(outDir!, "2b-after-operator.png") });
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
