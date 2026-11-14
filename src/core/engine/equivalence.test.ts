/**
 * Pass mark 1, "same numbers": on every kitchen the old engine handles, the task-centred
 * engine gives the same worker, start and tap for every step, and the same order times,
 * to within 1e-9 s, for the same seed and replication.
 *
 * Kitchens: 40 generated rooms (original, fridge closer, fourth worker, built as
 * tools/coverage/coverage.ts builds them) and the three fixture folders.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateRun } from "../../../tools/world/generate";
import { RUNS } from "../../../tools/world/runs";
import { COVERAGE_SEEDS } from "../../../tools/coverage/coverage";
import type { Layout, PositionSample, Scan, Setup, TapEvent } from "../types";
import { resolveWorld, type World } from "../world";
import { reconstructRun } from "../reconstruct";
import { calibrate, type Calibration } from "../calibrate";
import { compileModel } from "../model";
import { runReplication, type Releases, type ReplicationOptions } from "../sim";
import { compileEngineModel, runEngine } from "./index";

const ROOMS = 40;
const REPS = 5;
const TOL = 1e-9;
const FIXTURES = join(__dirname, "..", "..", "..", "fixtures");
const FIXTURE_IDS = ["counter-a", "counter-b-fridge-closer", "counter-c-fourth-worker"];

interface Files {
  readonly scan: Scan;
  readonly setup: Setup;
  readonly layout: Layout;
  readonly taps: readonly TapEvent[];
  readonly positions: readonly PositionSample[];
}

interface Kitchen {
  readonly name: string;
  readonly world: World;
  readonly cal: Calibration;
  readonly releases: Releases;
}

function jsonl<T>(text: string): T[] {
  return text
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as { type: string })
    .filter((l) => l.type !== "header") as T[];
}

function fromText(read: (f: string) => string): Files {
  return {
    scan: JSON.parse(read("scan.json")) as Scan,
    setup: JSON.parse(read("setup.json")) as Setup,
    layout: JSON.parse(read("layout.json")) as Layout,
    taps: jsonl<TapEvent>(read("taps.jsonl")),
    positions: jsonl<PositionSample>(read("positions.jsonl")),
  };
}

function generated(runIndex: number, seed: number): Files {
  const files = generateRun({ ...(RUNS[runIndex] as (typeof RUNS)[number]), seed }).files;
  return fromText((f) => (files as Readonly<Record<string, string>>)[f] as string);
}

/** The original and its two changed runs, all calibrated on the original. */
function family(name: string, runs: readonly Files[]): readonly Kitchen[] {
  const a = runs[0] as Files;
  const worldA = resolveWorld(a.scan, a.setup, a.layout);
  const cal = calibrate(worldA, reconstructRun(a.setup, a.taps), a.positions);
  return runs.map((b, i) => ({
    name: `${name} run ${i}`,
    world: i === 0 ? worldA : resolveWorld(a.scan, a.setup, b.layout),
    cal,
    releases: b.setup.schedule.orders,
  }));
}

function expectClose(actual: readonly number[], expected: readonly number[], what: string): void {
  expect(actual.length, what).toBe(expected.length);
  actual.forEach((v, i) => {
    const e = expected[i] as number;
    if (!(Math.abs(v - e) <= TOL)) expect.fail(`${what}[${i}]: engine ${v}, old ${e}`);
  });
}

function compareKitchen(k: Kitchen): number {
  const oldModel = compileModel(k.world, k.cal);
  const newModel = compileEngineModel(k.world, k.cal);
  let runs = 0;
  for (const paceModels of ["calibrated", "fit-or-speed"] as const) {
    for (let rep = 0; rep < REPS; rep += 1) {
      const opts: ReplicationOptions = { bootstrap: true, trace: true, paceModels };
      const where = `${k.name}, ${paceModels}, rep ${rep}`;
      const a = runReplication(oldModel, k.releases, 1, rep, opts);
      const b = runEngine(newModel, k.releases, 1, rep, opts);
      expectClose(b.orderTimes, a.orderTimes, `${where} orderTimes`);
      expectClose([b.lastFinish], [a.lastFinish], `${where} lastFinish`);
      compareSteps(a, b, where);
      runs += 1;
    }
  }
  return runs;
}

function compareSteps(a: ReturnType<typeof runReplication>, b: ReturnType<typeof runEngine>, where: string): void {
  const ao = a.trace?.orders ?? [];
  const bo = b.trace?.orders ?? [];
  expect(bo.length, where).toBe(ao.length);
  ao.forEach((o, i) => {
    const bs = bo[i]?.steps ?? [];
    expect(bs.length, `${where} ${o.orderId}`).toBe(o.steps.length);
    o.steps.forEach((s, k) => {
      const t = bs[k];
      const at = `${where} ${o.orderId} step ${k}`;
      expect(t?.workerId, at).toBe(s.workerId);
      expectClose([t?.startedAt ?? NaN, t?.tapAt ?? NaN], [s.startedAt ?? NaN, s.tapAt ?? NaN], `${at} start/tap`);
    });
  });
}

describe("the task-centred engine reproduces the old engine", () => {
  it.each(Array.from({ length: ROOMS }, (_, k) => k))("generated room %i (three runs)", (k) => {
    const runs = [0, 1, 2].map((idx) => generated(idx, COVERAGE_SEEDS[3 * k + idx] as number));
    const ran = family(`room ${k}`, runs).reduce((n, kitchen) => n + compareKitchen(kitchen), 0);
    expect(ran).toBe(3 * 2 * REPS);
  });

  it("the three fixture folders", () => {
    const runs = FIXTURE_IDS.map((id) => fromText((f) => readFileSync(join(FIXTURES, id, f), "utf8")));
    const ran = family("fixtures", runs).reduce((n, kitchen) => n + compareKitchen(kitchen), 0);
    expect(ran).toBe(3 * 2 * REPS);
  });
});
