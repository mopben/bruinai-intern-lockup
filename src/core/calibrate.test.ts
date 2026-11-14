import { describe, expect, it } from "vitest";
import type { PositionSample, TapEvent } from "./types";
import { resolveWorld } from "./world";
import { reconstructRun } from "./reconstruct";
import { calibrate, DEFAULT_WALK_SPEED_MPS, estimateWalkSpeed, MIN_WORK_S } from "./calibrate";
import { kitLayout, kitScan, kitSetup, worker, type KitSpec } from "./testkit";

/** A(0) -> B(3, fetch from F at 6) -> pickup P(10). Stand points on z = 0.85. */
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

/** One worker walks 6 m out and back at 1.5 m/s, then stands still; 10 Hz. */
function walkingLog(speed: number): PositionSample[] {
  const out: PositionSample[] = [];
  for (let i = 0; i <= 120; i += 1) {
    const t = i / 10;
    const walked = Math.min(t, 8) * speed; // 8 s of walking = 12 m
    const x = walked <= 6 ? walked : 12 - walked;
    out.push({ type: "pos", t, workerId: "wb", x, z: 0.85 });
    out.push({ type: "pos", t, workerId: "wa", x: 0, z: 0.85 });
  }
  return out;
}

/**
 * Hand-computed log at 1.5 m/s with work A = 2 s, B = 3 s:
 * carry A->B 3 m = 2 s one way; fetch B->F 6 m round = 4 s; carry B->P 14 m round = 9.333 s.
 * o1: A 0..2 (free 6), arrives B at 4, B taps 4+4+3 = 11 (free 20.333).
 * o2: A starts 6, taps 8; arrives B at 10, B starts 20.333, taps 27.333.
 */
const taps: readonly TapEvent[] = [
  { type: "order", t: 0, orderId: "o1", itemId: "latte" },
  { type: "order", t: 1, orderId: "o2", itemId: "latte" },
  { type: "done", t: 2, orderId: "o1", step: 0, stationId: "A" },
  { type: "done", t: 8, orderId: "o2", step: 0, stationId: "A" },
  { type: "done", t: 11, orderId: "o1", step: 1, stationId: "B" },
  { type: "done", t: 20 + 1 / 3 + 7, orderId: "o2", step: 1, stationId: "B" },
];

describe("calibrate", () => {
  it("recovers walking speed from positions, ignoring standing still", () => {
    const s = estimateWalkSpeed(walkingLog(1.5));
    expect(s.assumed).toBe(false);
    expect(s.mps).toBeCloseTo(1.5, 6);
  });

  it("states the default speed when there is no walking", () => {
    const s = estimateWalkSpeed([{ type: "pos", t: 0, workerId: "a", x: 0, z: 0 }]);
    expect(s).toEqual({ mps: DEFAULT_WALK_SPEED_MPS, assumed: true, samples: 0 });
  });

  it("recovers known work times from a hand-built log", () => {
    const c = calibrate(world, reconstructRun(world.setup, taps), walkingLog(1.5));
    expect(c.walkSpeedMps).toBeCloseTo(1.5, 6);
    expect(c.workSamples.A?.map((v) => +v.toFixed(6))).toEqual([2, 2]);
    expect(c.workSamples.B?.map((v) => +v.toFixed(6))).toEqual([3, 3]);
    expect(c.clampedCount).toBe(0);
    expect(c.sampleCount).toBe(4);
    expect(c.warnings).toEqual([]);
  });

  it("filters samples by order but keeps the queue state from every tap", () => {
    const c = calibrate(world, reconstructRun(world.setup, taps), walkingLog(1.5), { orderIds: new Set(["o2"]) });
    expect(c.workSamples.B?.map((v) => +v.toFixed(6))).toEqual([3]);
    expect(c.orderIds).toEqual(["o2"]);
  });

  it("clamps impossible work times and counts them", () => {
    const fast: TapEvent[] = [...taps.slice(0, 4), { type: "done", t: 5, orderId: "o1", step: 1, stationId: "B" }];
    const c = calibrate(world, reconstructRun(world.setup, fast), walkingLog(1.5));
    expect(c.workSamples.B).toEqual([MIN_WORK_S]);
    expect(c.clampedCount).toBe(1);
  });

  it("warns when a station has no usable samples and when speed is assumed", () => {
    const c = calibrate(world, reconstructRun(world.setup, taps.slice(0, 4)), []);
    expect(c.workSamples.B).toEqual([]);
    expect(c.walkSpeedAssumed).toBe(true);
    expect(c.warnings.join("\n")).toMatch(/No usable work times at "B"[\s\S]*assumed 1.2 m\/s/);
  });
});
