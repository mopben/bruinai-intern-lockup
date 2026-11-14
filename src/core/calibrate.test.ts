import { describe, expect, it } from "vitest";
import type { PositionSample, TapEvent } from "./types";
import { resolveWorld } from "./world";
import { reconstructRun } from "./reconstruct";
import { calibrate, DEFAULT_WALK_SPEED_MPS, estimateWalkSpeed, MIN_WORK_S } from "./calibrate";
import { kitLayout, kitScan, kitSetup, worker, type KitSpec } from "./testkit";

/** A(0) -> B(3, fetch from F at 6) -> pickup P(10). Stand points on z = 0.85, straight paths. */
const spec: KitSpec = {
  boxes: [
    { id: "A", x: 0, z: 0, role: "station" },
    { id: "B", x: 3, z: 0, role: "station" },
    { id: "F", x: 6, z: 0, role: "storage" },
    { id: "P", x: 10, z: 0, role: "pickup" },
  ],
  menu: [{ id: "latte", name: "Latte", steps: [{ stationId: "A" }, { stationId: "B", fetchFrom: ["F"] }] }],
  workers: [worker("wa", "A"), worker("wb", "B")],
  orders: [
    { orderId: "o1", itemId: "latte", t: 0 },
    { orderId: "o2", itemId: "latte", t: 1 },
  ],
};
const world = resolveWorld(kitScan(spec), kitSetup(spec), kitLayout(spec));

const CRUISE = 1.5;
const DWELL = 1; // reaching into the fridge / putting the cup down, at the far end

/** A trip at constant cruise speed with a dwell at the far end. */
interface HandTrip {
  readonly workerId: string;
  readonly fromX: number;
  readonly toX: number;
  readonly t0: number;
}

/** 10 Hz positions: each worker stands at home except during their trips. */
function positionsFor(trips: readonly HandTrip[], homes: Readonly<Record<string, number>>, endT: number): PositionSample[] {
  const out: PositionSample[] = [];
  for (const [workerId, homeX] of Object.entries(homes)) {
    const mine = trips.filter((t) => t.workerId === workerId);
    for (let i = 0; i <= endT * 10; i += 1) {
      const t = i / 10;
      let x = homeX;
      for (const tr of mine) {
        const leg = Math.abs(tr.toX - tr.fromX) / CRUISE;
        const dir = Math.sign(tr.toX - tr.fromX);
        const dt = t - tr.t0;
        if (dt < 0 || dt > 2 * leg + DWELL) continue;
        const along = dt < leg ? dt * CRUISE : dt < leg + DWELL ? leg * CRUISE : (2 * leg + DWELL - dt) * CRUISE;
        x = tr.fromX + dir * along;
      }
      out.push({ type: "pos", t, workerId, x, z: 0.85 });
    }
  }
  return out;
}

/**
 * Hand-computed run with pace "1 s per round trip + distance / 1.5 m/s" and work A = 2 s, B = 3 s.
 * Model: one-way time = 0.5 + d / 1.5. A->B 3 m: 2.5 s; fetch B->F->B: 5 s; carry B->P 7 m: 5.1667 s one way.
 * o1: A 0..2, arrives B 4.5, wa free 7. B starts 4.5, fetch 5, work 3 -> tap 12.5; wb free 12.5 + 10.3333 = 22.8333.
 * o2: A starts 7, taps 9, free 14, arrives B 11.5. B starts 22.8333 -> tap 30.8333.
 */
const T_O2_B = 22 + 5 / 6;
const taps: readonly TapEvent[] = [
  { type: "order", t: 0, orderId: "o1", itemId: "latte" },
  { type: "order", t: 1, orderId: "o2", itemId: "latte" },
  { type: "done", t: 2, orderId: "o1", step: 0, stationId: "A" },
  { type: "done", t: 9, orderId: "o2", step: 0, stationId: "A" },
  { type: "done", t: 12.5, orderId: "o1", step: 1, stationId: "B" },
  { type: "done", t: T_O2_B + 8, orderId: "o2", step: 1, stationId: "B" },
];
const handTrips: readonly HandTrip[] = [
  { workerId: "wa", fromX: 0, toX: 3, t0: 2 },
  { workerId: "wa", fromX: 0, toX: 3, t0: 9 },
  { workerId: "wb", fromX: 3, toX: 6, t0: 4.5 },
  { workerId: "wb", fromX: 3, toX: 10, t0: 12.5 },
  { workerId: "wb", fromX: 3, toX: 6, t0: T_O2_B },
  { workerId: "wb", fromX: 3, toX: 10, t0: T_O2_B + 8 },
];
const positions = positionsFor(handTrips, { wa: 0, wb: 3 }, 45);

describe("walking pace from whole trips", () => {
  it("fits overhead + distance / speed from trips of two lengths", () => {
    const c = calibrate(world, reconstructRun(world.setup, taps), positions);
    expect(c.paceMethod).toBe("trip-fit");
    expect(c.paceTrips.map((t) => t.group).sort()).toEqual(["carry:B", "carry:B", "carry:P", "carry:P", "fetch:F", "fetch:F"]);
    expect(c.walkSpeedMps).toBeCloseTo(CRUISE, 6);
    expect(c.walkOverheadS).toBeCloseTo(DWELL, 6);
    expect(c.warnings).toEqual([]);
  });

  it("the instantaneous median gets the trip times wrong; the trip estimator gets them right", () => {
    // The 6 m fetch round trip really takes 5 s. Moment-to-moment speed only sees the 1.5 m/s cruise.
    const instant = estimateWalkSpeed(positions);
    expect(instant.mps).toBeCloseTo(1.5, 6);
    expect(6 / instant.mps).toBeCloseTo(4, 6); // 1 s short
    const c = calibrate(world, reconstructRun(world.setup, taps), positions);
    expect(c.walkOverheadS + 6 / c.walkSpeedMps).toBeCloseTo(5, 6);
    expect(c.walkOverheadS + 14 / c.walkSpeedMps).toBeCloseTo(14 / 1.5 + 1, 6);
  });

  it("then recovers the known work times exactly", () => {
    const c = calibrate(world, reconstructRun(world.setup, taps), positions);
    expect(c.workSamples.A?.map((v) => +v.toFixed(6))).toEqual([2, 2]);
    expect(c.workSamples.B?.map((v) => +v.toFixed(6))).toEqual([3, 3]);
    expect(c.clampedCount).toBe(0);
    expect(c.sampleCount).toBe(4);
  });

  it("uses one effective pace, and says so, when trips are all one length", () => {
    const sameLength = positionsFor(handTrips.filter((t) => t.toX !== 10), { wa: 0, wb: 3 }, 45);
    const c = calibrate(world, reconstructRun(world.setup, taps), sameLength);
    expect(c.paceMethod).toBe("trip-speed");
    expect(c.walkOverheadS).toBe(0);
    // Every trip covers 6 m less the home-circle ends in (5 s less the matching time): 1.2 m/s effective.
    expect(c.walkSpeedMps).toBeCloseTo(1.2, 1);
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
