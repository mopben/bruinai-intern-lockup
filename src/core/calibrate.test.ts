import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Layout, PositionSample, Scan, Setup, TapEvent } from "./types";
import { resolveWorld } from "./world";
import { reconstructRun } from "./reconstruct";
import { calibrate, DEFAULT_WALK_SPEED_MPS, estimateWalkSpeed, MIN_TASK_SAMPLES, MIN_WORK_S, taskKey } from "./calibrate";
import { fixedCalibration, kitLayout, kitScan, kitSetup, tapsFromTrace, worker, type KitSpec } from "./testkit";
import { isChainKitchen } from "./tasks";
import { compileEngineModel, runEngine } from "./engine";
import { buildKitchen, coveringKitchen, joinKitchen } from "./engine/test-kitchens";

/** A(0) -> B(3, fetch from F at 6) -> pickup P(10.5). Stand points on z = 0.85, straight paths. */
const spec: KitSpec = {
  boxes: [
    { id: "A", x: 0, z: 0, role: "station" },
    { id: "B", x: 3, z: 0, role: "station" },
    { id: "F", x: 6, z: 0, role: "storage" },
    { id: "P", x: 10.5, z: 0, role: "pickup" },
  ],
  menu: [{ id: "latte", name: "Latte", steps: [{ stationId: "A" }, { stationId: "B", fetchFrom: ["F"] }] }],
  workers: [worker("wa", "A"), worker("wb", "B")],
  orders: [
    { orderId: "o1", itemId: "latte", t: 0 },
    { orderId: "o2", itemId: "latte", t: 1 },
  ],
};
const world = resolveWorld(kitScan(spec), kitSetup(spec), kitLayout(spec));

/**
 * Walking profile, rest to rest: accelerate at 1.5 m/s^2 to 1.5 m/s (1 s, 0.75 m), cruise,
 * decelerate (1 s, 0.75 m). One way over L metres takes L / 1.5 + 1 s, so a round trip is
 * RT / 1.5 + 2 s: speed 1.5 m/s and 2 s overhead per round trip, exactly.
 */
const CRUISE = 1.5;
const ACCEL = 1.5;
function along(L: number, dt: number): number {
  const ta = CRUISE / ACCEL;
  const da = (CRUISE * ta) / 2;
  const tc = (L - 2 * da) / CRUISE;
  if (dt <= ta) return 0.5 * ACCEL * dt * dt;
  if (dt <= ta + tc) return da + CRUISE * (dt - ta);
  const r = Math.min(dt - ta - tc, ta);
  return da + CRUISE * tc + CRUISE * r - 0.5 * ACCEL * r * r;
}
const oneWay = (L: number): number => L / CRUISE + CRUISE / ACCEL;

interface HandTrip {
  readonly workerId: string;
  readonly fromX: number;
  readonly toX: number;
  readonly t0: number;
}

/** 10 Hz positions: each worker stands at home except during their trips (out, straight back). */
function positionsFor(trips: readonly HandTrip[], homes: Readonly<Record<string, number>>, endT: number, z = 0.85): PositionSample[] {
  const out: PositionSample[] = [];
  for (const [workerId, homeX] of Object.entries(homes)) {
    const mine = trips.filter((t) => t.workerId === workerId);
    for (let i = 0; i <= endT * 10; i += 1) {
      const t = i / 10;
      let x = homeX;
      for (const tr of mine) {
        const L = Math.abs(tr.toX - tr.fromX);
        const dir = Math.sign(tr.toX - tr.fromX);
        const dt = t - tr.t0;
        const T = oneWay(L);
        if (dt < 0 || dt > 2 * T) continue;
        x = tr.fromX + dir * (dt <= T ? along(L, dt) : L - along(L, dt - T));
      }
      out.push({ type: "pos", t: Math.round(t * 10) / 10, workerId, x, z });
    }
  }
  return out;
}

/**
 * Hand-computed run with that pace and work A = 2 s, B = 3 s. Model one-way = 1 + L / 1.5:
 * A->B 3 m: 3 s; fetch B->F->B: 6 s; carry B->P 7.5 m: 6 s one way.
 * o1: A 0..2, arrives B 5, wa free 8. B starts 5, fetch 6, work 3 -> tap 14; wb free 26.
 * o2: A starts 8, taps 10, free 16, arrives B 13. B starts 26 -> tap 35.
 */
const taps: readonly TapEvent[] = [
  { type: "order", t: 0, orderId: "o1", itemId: "latte" },
  { type: "order", t: 1, orderId: "o2", itemId: "latte" },
  { type: "done", t: 2, orderId: "o1", step: 0, stationId: "A" },
  { type: "done", t: 10, orderId: "o2", step: 0, stationId: "A" },
  { type: "done", t: 14, orderId: "o1", step: 1, stationId: "B" },
  { type: "done", t: 35, orderId: "o2", step: 1, stationId: "B" },
];
const handTrips: readonly HandTrip[] = [
  { workerId: "wa", fromX: 0, toX: 3, t0: 2 },
  { workerId: "wa", fromX: 0, toX: 3, t0: 10 },
  { workerId: "wb", fromX: 3, toX: 6, t0: 5 },
  { workerId: "wb", fromX: 3, toX: 10.5, t0: 14 },
  { workerId: "wb", fromX: 3, toX: 6, t0: 26 },
  { workerId: "wb", fromX: 3, toX: 10.5, t0: 35 },
];
const positions = positionsFor(handTrips, { wa: 0, wb: 3 }, 50);

/** The previous timing: from crossing a 0.25 m circle round home, distance trimmed by the two 0.25 m ends. */
function oldStyleTiming(list: readonly PositionSample[], homeX: number, t0: number, t1: number): { durationS: number; trimmedM: number } {
  const mine = list.filter((p) => p.workerId === "wb" && p.t >= t0 && p.t <= t1);
  const out = mine.filter((p) => Math.abs(p.x - homeX) > 0.25);
  const first = mine.filter((p) => p.t < out[0]!.t).at(-1)!;
  const last = mine.find((p) => p.t > out.at(-1)!.t)!;
  return { durationS: last.t - first.t, trimmedM: Math.abs(first.x - homeX) + Math.abs(last.x - homeX) };
}

describe("walking pace from whole trips, rest to rest", () => {
  it("times each trip from rest to rest and pairs it with the full round trip", () => {
    const c = calibrate(world, reconstructRun(world.setup, taps), positions);
    expect(c.paceTrips.map((t) => [t.workerId, t.group, t.t0, t.t1, +t.distanceM.toFixed(9)])).toEqual([
      ["wa", "carry:B", 2, 8, 6],
      ["wa", "carry:B", 10, 16, 6],
      ["wb", "fetch:F", 5, 11, 6],
      ["wb", "carry:P", 14, 26, 15],
      ["wb", "fetch:F", 26, 32, 6],
      ["wb", "carry:P", 35, 47, 15],
    ]);
  });

  it("fits speed and stop/start overhead exactly", () => {
    const c = calibrate(world, reconstructRun(world.setup, taps), positions);
    expect(c.paceMethod).toBe("trip-fit");
    expect(c.walkSpeedMps).toBeCloseTo(CRUISE, 6);
    expect(c.walkOverheadS).toBeCloseTo(2 * (CRUISE / ACCEL), 6);
    expect(c.warnings).toEqual([]);
  });

  it("the old circle-crossing timing is short by a computable amount; the new one is exact", () => {
    // Crossing 0.25 m from rest takes sqrt(2 * 0.25 / 1.5) = 0.577 s at each end, but the old fit charged
    // those 0.5 m at cruise (0.333 s): short by 2 * 0.577 - 0.333 = 0.82 s per round trip.
    const old = oldStyleTiming(positions, 3, 5, 11);
    const charged = old.durationS + old.trimmedM / CRUISE;
    const expectedShort = 2 * Math.sqrt((2 * 0.25) / ACCEL) - 0.5 / CRUISE;
    expect(Math.abs(6 - charged - expectedShort)).toBeLessThan(0.1); // 10 Hz sampling
    const c = calibrate(world, reconstructRun(world.setup, taps), positions);
    const fetch = c.paceTrips.find((t) => t.group === "fetch:F")!;
    expect(fetch.durationS).toBeCloseTo(c.walkOverheadS + fetch.distanceM / c.walkSpeedMps, 9);
    expect(fetch.durationS).toBe(6);
    // The moment-to-moment median only sees the cruise and would say 4 s for the same walk.
    expect(6 / estimateWalkSpeed(positions).mps).toBeCloseTo(4, 1);
  });

  it("then recovers the known work times exactly", () => {
    const c = calibrate(world, reconstructRun(world.setup, taps), positions);
    expect(c.workSamples.A?.map((v) => +v.toFixed(6))).toEqual([2, 2]);
    expect(c.workSamples.B?.map((v) => +v.toFixed(6))).toEqual([3, 3]);
    expect(c.clampedCount).toBe(0);
    expect(c.sampleCount).toBe(4);
  });

  it("uses each worker's own resting place as home when two share a station", () => {
    // Two workers at B rest 0.28 m either side of its stand point and take turns fetching.
    const two: KitSpec = { ...spec, workers: [worker("wa", "A"), worker("wb", "B"), worker("wc", "B")] };
    const w2 = resolveWorld(kitScan(two), kitSetup(two), kitLayout(two));
    const trips2: HandTrip[] = [
      { workerId: "wb", fromX: 2.72, toX: 6, t0: 2 },
      { workerId: "wc", fromX: 3.28, toX: 6, t0: 4 },
      { workerId: "wb", fromX: 2.72, toX: 10.5, t0: 12 },
      { workerId: "wc", fromX: 3.28, toX: 10.5, t0: 14 },
      { workerId: "wb", fromX: 2.72, toX: 6, t0: 28 },
      { workerId: "wc", fromX: 3.28, toX: 10.5, t0: 30 },
    ];
    const pos = positionsFor(trips2, { wb: 2.72, wc: 3.28 }, 50);
    const c = calibrate(w2, reconstructRun(w2.setup, taps), pos);
    expect(c.paceTrips).toHaveLength(6);
    const byWorker = (id: string) => c.paceTrips.filter((t) => t.workerId === id).map((t) => t.t0);
    expect(byWorker("wb")).toEqual([2, 12, 28]);
    expect(byWorker("wc")).toEqual([4, 14, 30]);
    // Each trip was timed rest to rest from its own home; fetches are 6.56 m / 5.44 m round trips in
    // reality but the model uses the stand point's 6 m, so the fitted speed is near, not equal, 1.5 m/s.
    expect(c.paceMethod).toBe("trip-fit");
    expect(c.walkSpeedMps).toBeGreaterThan(1.3);
  });

  it("uses one effective pace, and says so, when trips are all one length", () => {
    const sameLength = positionsFor(handTrips.filter((t) => t.toX !== 10.5), { wa: 0, wb: 3 }, 50);
    const c = calibrate(world, reconstructRun(world.setup, taps), sameLength);
    expect(c.paceMethod).toBe("trip-speed");
    expect(c.walkOverheadS).toBe(0);
    expect(c.walkSpeedMps).toBeCloseTo(1, 6); // 6 m in 6 s
    expect(c.warnings.join()).toMatch(/all about the same length/);
  });

  it("falls back to moment-to-moment speed when there are no whole trips", () => {
    const wander: PositionSample[] = Array.from({ length: 81 }, (_, i) => ({ type: "pos", t: i / 10, workerId: "stranger", x: (i / 10) * 1.4, z: 5 }));
    const c = calibrate(world, reconstructRun(world.setup, taps), wander);
    expect(c.paceMethod).toBe("windows");
    expect(c.walkSpeedMps).toBeCloseTo(1.4, 6);
    expect(c.warnings.join()).toMatch(/moment-to-moment/);
  });

  it("states the default speed when there is no walking at all", () => {
    expect(estimateWalkSpeed([{ type: "pos", t: 0, workerId: "a", x: 0, z: 0 }])).toEqual({ mps: DEFAULT_WALK_SPEED_MPS, assumed: true, samples: 0 });
    const c = calibrate(world, reconstructRun(world.setup, taps), []);
    expect(c.paceMethod).toBe("assumed");
    expect(c.walkSpeedAssumed).toBe(true);
    expect(c.warnings.join()).toMatch(/assumed 1.2 m\/s/);
  });
});

describe("work-time samples", () => {
  it("filters samples by order but keeps the queue state from every tap", () => {
    const c = calibrate(world, reconstructRun(world.setup, taps), positions, { orderIds: new Set(["o2"]) });
    expect(c.workSamples.B?.map((v) => +v.toFixed(6))).toEqual([3]);
    expect(c.orderIds).toEqual(["o2"]);
  });

  it("clamps impossible work times and counts them", () => {
    const fast: TapEvent[] = [...taps.slice(0, 4), { type: "done", t: 5, orderId: "o1", step: 1, stationId: "B" }];
    const c = calibrate(world, reconstructRun(world.setup, fast), positions);
    expect(c.workSamples.B).toEqual([MIN_WORK_S]);
    expect(c.clampedCount).toBe(1);
  });

  it("warns when a station has no usable samples", () => {
    const c = calibrate(world, reconstructRun(world.setup, taps.slice(0, 4)), positions);
    expect(c.workSamples.B).toEqual([]);
    expect(c.warnings.join("\n")).toMatch(/No usable work times at "B"/);
  });
});

describe("task samples", () => {
  const root = join(__dirname, "..", "..", "fixtures", "counter-a");
  const have = existsSync(join(root, "taps.jsonl"));
  const read = (f: string): string => readFileSync(join(root, f), "utf8");
  const jsonl = <T,>(text: string): T[] =>
    text
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as { type: string })
      .filter((l) => l.type !== "header") as T[];

  it.skipIf(!have)("keys the samples of counter-a by item and task, equal to the station's", () => {
    const setup = JSON.parse(read("setup.json")) as Setup;
    const w = resolveWorld(JSON.parse(read("scan.json")) as Scan, setup, JSON.parse(read("layout.json")) as Layout);
    const c = calibrate(w, reconstructRun(setup, jsonl<TapEvent>(read("taps.jsonl"))), jsonl<PositionSample>(read("positions.jsonl")));
    const item = w.menu[0]!;
    const make = item.steps[1]!.stationId;
    expect(c.workSamples[make]!.length).toBeGreaterThan(0);
    expect(c.taskSamples[taskKey(item.id, "s1")]).toEqual(c.workSamples[make]);
    expect(MIN_TASK_SAMPLES).toBe(3);
  });
});

describe("calibration beyond chains (replayed over the taps)", () => {
  const releases = [0, 1, 2, 30, 31, 32].map((t, i) => ({ orderId: `o${i + 1}`, itemId: "x", t }));
  const truth = fixedCalibration({ a: [2], b: [2], c: [2] }, DEFAULT_WALK_SPEED_MPS);
  const roundTrip = (spec: KitSpec) => {
    const w = buildKitchen({ ...spec, orders: releases });
    const trace = runEngine(compileEngineModel(w, truth), releases, 1, 0, { bootstrap: false, trace: true }).trace!;
    return { w, taps: tapsFromTrace(trace) };
  };
  const allTwo = (c: ReturnType<typeof calibrate>) => {
    const values = Object.values(c.taskSamples).flat();
    expect(values.length).toBeGreaterThan(0);
    for (const v of values) expect(Math.abs(v - 2)).toBeLessThan(1e-6);
  };

  it("recovers every work time of the covering-worker kitchen", () => {
    const { w, taps } = roundTrip(coveringKitchen());
    expect(isChainKitchen(w.menu, w.workers)).toBe(false);
    const c = calibrate(w, reconstructRun(w.setup, taps), []);
    expect(c.paceMethod).toBe("assumed");
    allTwo(c);
    expect(Object.values(c.taskSamples).flat()).toHaveLength(2 * releases.length);
    expect(c.clampedCount).toBe(0);
    expect(c.warnings.join("\n")).not.toMatch(/do not say who/);
  });

  it("recovers every work time of a join kitchen with fixed workers", () => {
    const { w, taps } = roundTrip(joinKitchen());
    const c = calibrate(w, reconstructRun(w.setup, taps), []);
    allTwo(c);
    expect(Object.values(c.taskSamples).flat()).toHaveLength(3 * releases.length);
  });

  it("recovers every work time of a join kitchen whose worker also covers the joining station", () => {
    const { w, taps } = roundTrip(joinKitchen([worker("wa", "a", ["c"]), worker("wb", "b")]));
    const c = calibrate(w, reconstructRun(w.setup, taps), []);
    allTwo(c);
    expect(Object.values(c.taskSamples).flat()).toHaveLength(3 * releases.length);
  });

  it("skips taps that do not say who did the step, with one warning", () => {
    const { w, taps } = roundTrip(coveringKitchen());
    const anonymous: TapEvent[] = taps.map((e) => {
      if (e.type !== "done") return e;
      const { workerId: _drop, ...rest } = e;
      return rest;
    });
    const c = calibrate(w, reconstructRun(w.setup, anonymous), []);
    expect(Object.values(c.taskSamples).flat()).toEqual([]);
    expect(Object.values(c.workSamples).flat()).toEqual([]);
    expect(c.warnings.filter((s) => s === "Some taps do not say who did the step, so their work times could not be learned.")).toHaveLength(1);
  });
});
