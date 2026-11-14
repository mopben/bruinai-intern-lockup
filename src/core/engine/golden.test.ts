/**
 * Frozen results of the old station-queue engine (src/core/sim.ts), which this engine
 * replaced. The engine must still give the same order times and, for every step, the same
 * worker, start and tap, to within 1e-9 s.
 *
 * How golden.json was made (once, by a script that was not kept, because it needed the
 * old engine): at commit 78e5fad, `compileModel` + `runReplication` on the three fixture
 * folders (counter-a, counter-b-fridge-closer, counter-c-fourth-worker), each calibrated
 * on counter-a (taps and positions) and run with its own setup's schedule; seed 1,
 * replications 0, 1 and 2, options { bootstrap: true, trace: true } with paceModels
 * "calibrated" and again with "fit-or-speed". Do not regenerate it from this engine.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Layout, PositionSample, Scan, Setup, TapEvent } from "../types";
import { resolveWorld, type World } from "../world";
import { reconstructRun } from "../reconstruct";
import { calibrate } from "../calibrate";
import { compileEngineModel, runEngine } from "./index";

const TOL = 1e-9;
const FIXTURES = join(__dirname, "..", "..", "..", "fixtures");

interface GoldenStep {
  readonly workerId: string | null;
  readonly startedAt: number;
  readonly tapAt: number;
}

interface GoldenRun {
  readonly fixture: string;
  readonly paceModels: "calibrated" | "fit-or-speed";
  readonly rep: number;
  readonly orderTimes: readonly number[];
  readonly steps: readonly (readonly GoldenStep[])[];
}

interface Golden {
  readonly seed: number;
  readonly calibratedOn: string;
  readonly runs: readonly GoldenRun[];
}

const golden = JSON.parse(readFileSync(join(__dirname, "golden.json"), "utf8")) as Golden;

function jsonl<T>(text: string): T[] {
  return text
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as { type: string })
    .filter((l) => l.type !== "header") as T[];
}

const read = (id: string, f: string): string => readFileSync(join(FIXTURES, id, f), "utf8");
const setupOf = (id: string): Setup => JSON.parse(read(id, "setup.json")) as Setup;
const worldOf = (id: string): World =>
  resolveWorld(JSON.parse(read(golden.calibratedOn, "scan.json")) as Scan, setupOf(golden.calibratedOn), JSON.parse(read(id, "layout.json")) as Layout);

const base = worldOf(golden.calibratedOn);
const cal = calibrate(base, reconstructRun(base.setup, jsonl<TapEvent>(read(golden.calibratedOn, "taps.jsonl"))), jsonl<PositionSample>(read(golden.calibratedOn, "positions.jsonl")));

function expectClose(actual: number, expected: number, what: string): void {
  if (!(Math.abs(actual - expected) <= TOL)) expect.fail(`${what}: engine ${actual}, golden ${expected}`);
}

describe("the engine matches the frozen old-engine results", () => {
  it("covers three fixtures, three replications and both pace modes", () => {
    expect(golden.runs).toHaveLength(18);
  });

  it.each(golden.runs.map((g) => [`${g.fixture}, ${g.paceModels}, rep ${g.rep}`, g] as const))("%s", (_, g) => {
    const model = compileEngineModel(worldOf(g.fixture), cal);
    const r = runEngine(model, setupOf(g.fixture).schedule.orders, golden.seed, g.rep, { bootstrap: true, trace: true, paceModels: g.paceModels });
    expect(r.orderTimes).toHaveLength(g.orderTimes.length);
    g.orderTimes.forEach((t, i) => expectClose(r.orderTimes[i] as number, t, `order ${i} time`));
    g.steps.forEach((steps, i) => {
      const got = r.trace?.orders[i]?.steps ?? [];
      expect(got, `order ${i} steps`).toHaveLength(steps.length);
      steps.forEach((s, k) => {
        expect(got[k]?.workerId, `order ${i} step ${k} worker`).toBe(s.workerId);
        expectClose(got[k]?.startedAt ?? NaN, s.startedAt, `order ${i} step ${k} start`);
        expectClose(got[k]?.tapAt ?? NaN, s.tapAt, `order ${i} step ${k} tap`);
      });
    });
  });
});
