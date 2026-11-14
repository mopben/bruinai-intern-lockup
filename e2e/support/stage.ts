/**
 * Driving the stage page: open it, press keys, read numbers and the test hook.
 */
import { expect, type Page } from "@playwright/test";
import type { SceneDebug } from "../../src/stage/scene/api";
import { REPLAY_PORT, origin } from "./ports";

export const VIEW_IDS = ["scan", "play", "orders", "compare", "run", "test"] as const;
export type View = (typeof VIEW_IDS)[number];

/** Box ids in the fixture scan (fixtures/counter-a/setup.json). */
export const BOX = {
  order: "61A93A22-761D-47DF-BC5F-5EB3A7D8334A",
  make: "98EA7E27-B557-42A2-9AE3-1C7A609FDAC0",
  finish: "9886D544-4186-4B47-978D-7D032CCECDEA",
  fridge: "65E69210-5EED-4D93-9F34-955C39B9EDBF",
  pickup: "81C9EBC2-31C1-4C98-879A-0EAB5851BF60",
} as const;
export const STATIONS = [BOX.order, BOX.make, BOX.finish] as const;

export interface OpenOptions {
  readonly emptyWorkspace?: boolean;
  readonly port?: number;
  readonly speed?: number;
  readonly step?: number;
  readonly view?: "compare" | "run" | "test";
  readonly mode?: "replay" | "live";
  readonly run?: string;
}

export async function openStage(page: Page, o: OpenOptions = {}): Promise<void> {
  const q = new URLSearchParams();
  if (o.run) q.set("run", o.run);
  if (o.mode) q.set("mode", o.mode);
  if (o.speed) q.set("speed", String(o.speed));
  if (o.step) q.set("step", String(o.step));
  if (o.view) q.set("view", o.view);
  await page.goto(`${origin(o.port ?? REPLAY_PORT)}/?${q.toString()}`);
  await page.waitForFunction(() => "__dryrun" in globalThis);
  await expect(page.getByTestId("step-strip")).toBeVisible();
  await expect(page.getByText("Loading the kitchen…")).toHaveCount(0);
  if (!o.emptyWorkspace && await page.getByTestId("active-setup").count() && !await page.getByTestId("active-setup").inputValue()) {
    await page.getByTestId("active-setup").selectOption("__create_setup__");
  }
}

export async function currentStep(page: Page): Promise<string> {
  return page.evaluate(() => (globalThis as unknown as { __dryrun: { step(): string } }).__dryrun.step());
}

export async function expectStep(page: Page, view: View): Promise<void> {
  const step = (view === "scan" || view === "play") ? "build" : view === "orders" ? "orders" : "results";
  await expect(page.getByTestId(`step-${step}`)).toHaveAttribute("aria-current", "step");
  if (step === "results") await expect(page.getByTestId(`view-${view}`)).toHaveAttribute("aria-current", "page");
}

export async function goView(page: Page, view: View): Promise<void> {
  await page.keyboard.press((view === "scan" || view === "play") ? "1" : view === "orders" ? "2" : "3");
  if (view === "run" || view === "test") await page.getByTestId(`view-${view}`).click();
  await expectStep(page, view);
}

export async function mainDebug(page: Page): Promise<SceneDebug> {
  const d = await page.evaluate(() => (globalThis as unknown as { __dryrun: { main(): unknown } }).__dryrun.main());
  if (!d) throw new Error("the main scene does not exist");
  return d as SceneDebug;
}

export async function sceneDebug(page: Page, name: string): Promise<SceneDebug | null> {
  return (await page.evaluate((n) => (globalThis as unknown as { __dryrun: { scene(n: string): unknown } }).__dryrun.scene(n), name)) as SceneDebug | null;
}

export interface SessionView {
  readonly purpose: "first" | "second";
  readonly status: "idle" | "running" | "ended";
  readonly t: number;
  readonly done: number;
  readonly total: number;
  readonly replay: boolean;
  readonly save: { readonly kind: string; readonly where?: string };
}

export async function session(page: Page): Promise<SessionView | null> {
  return (await page.evaluate(() => (globalThis as unknown as { __dryrun: { session(): unknown } }).__dryrun.session())) as SessionView | null;
}

export async function waitForSession(page: Page, purpose: "first" | "second", status: SessionView["status"], timeout = 60_000): Promise<void> {
  await expect
    .poll(async () => {
      const s = await session(page);
      return s && s.purpose === purpose ? s.status : null;
    }, { timeout, intervals: [100, 200, 250] })
    .toBe(status);
}

export async function text(page: Page, testId: string): Promise<string> {
  return (await page.getByTestId(testId).first().innerText()).trim();
}

/** "1:05" to seconds. */
export function clockSeconds(s: string): number {
  const m = /^(\d+):(\d{2})$/.exec(s.trim());
  if (!m) throw new Error(`not a clock: "${s}"`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Collects, in the page, the main scene's tickets per station on every frame
 * until stopped. Returns a handle to read the samples.
 */
export async function startQueueSampler(page: Page): Promise<void> {
  await page.evaluate(() => {
    const g = globalThis as unknown as { __dryrun: { main(): { queues: Record<string, number>; alerts: string[] } | null }; __samples?: unknown[]; __sampling?: boolean };
    g.__samples = [];
    g.__sampling = true;
    const tick = () => {
      if (!g.__sampling) return;
      const d = g.__dryrun.main();
      if (d) (g.__samples as unknown[]).push({ q: d.queues, a: d.alerts });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

export async function stopQueueSampler(page: Page): Promise<{ q: Record<string, number>; a: string[] }[]> {
  return page.evaluate(() => {
    const g = globalThis as unknown as { __samples?: unknown[]; __sampling?: boolean };
    g.__sampling = false;
    return (g.__samples ?? []) as { q: Record<string, number>; a: string[] }[];
  });
}

/** Calls a read-only test-hook function in the page (src/stage/state/test-hook.ts). */
export async function hook<T>(page: Page, name: string): Promise<T> {
  return (await page.evaluate((n) => {
    const h = (globalThis as unknown as { __dryrun: Record<string, () => unknown> }).__dryrun;
    return h[n]!();
  }, name)) as T;
}

export interface RangeV {
  readonly p10: number;
  readonly p50: number;
  readonly p90: number;
}
