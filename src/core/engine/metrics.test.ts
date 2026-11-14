import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Layout, PositionSample, Scan, Setup, TapEvent } from "../types";
import type { Calibration } from "../calibrate";
import { evenOrders, type KitSpec } from "../testkit";
import { walkingPerOrder } from "../walking";
import { calibrate, predict, reconstructRun, resolveWorld } from "../index";
import { compileEngineModel, runEngine } from "./index";
import { buildKitchen, capacityKitchen, coveringKitchen, exactCalibration, oneWorkerChainKitchen } from "./test-kitchens";

const exact = { bootstrap: false } as const;
const runOn = (spec: KitSpec, cal: Calibration, releases = spec.orders ?? []) => runEngine(compileEngineModel(buildKitchen(spec), cal), releases, 1, 0, exact);
const predictOn = (spec: KitSpec, cal: Calibration, releases = spec.orders ?? []) => predict(buildKitchen(spec), cal, { reps: 3, bootstrap: false, releases });

describe("replication stats", () => {
  it("capacity kitchen: the second task waits 3 s for the one place", () => {
    // Two orders at 0, one place at s, 3 s work. w1 takes o1 at 0 (wait 0).
    // o2 is ready at 0 but s is full until the tap at 3: assigned at 3, wait 3 - 0 = 3.
    // Queue: after o1's arrival nothing is left; after o2's, one task is ready and unassigned.
    const r = runOn(capacityKitchen(2, 1), exactCalibration({ s: 3 }), evenOrders(2, 0, "x"));
    expect(r.stats.waitS).toEqual([3]);
    expect(r.stats.waits).toEqual([2]);
    expect(r.stats.peakQueue).toEqual([1]);
    // Each worker works 3 s; hand-off pickup, no walks.
    expect(r.stats.busyS).toEqual([3, 3]);
    expect(r.stats.betweenM).toBe(0);
  });

  it("a fixed worker is busy for work, carry and the walk back; carry is not between-station walking", () => {
    // Per order: work 2 + carry 3 m at 1 m/s (3 s) + walk back 3 s = 8 s; three orders = 24 s.
    const r = runOn(oneWorkerChainKitchen(), exactCalibration({ s: 2 }), evenOrders(3, 10, "x"));
    expect(r.stats.busyS).toEqual([24]);
    expect(r.stats.betweenM).toBe(0);
    expect(r.stats.waitS).toEqual([0]);
    expect(r.stats.peakQueue).toEqual([0]);
  });

  it("a covering worker's walk home counts as busy and as between-station walking", () => {
    // a 0-1 (work 1), carry 4 m 1-5 (4 s), work at b 5-6 (1 s), walk home 6-10 (4 s): busy 10 s.
    // Only the walk home is between stations: 4 m. b's task is ready at 5 and taken at 5.
    const r = runOn(coveringKitchen(), exactCalibration({ a: 1, b: 1 }));
    expect(r.stats.busyS).toEqual([10]);
    expect(r.stats.betweenM).toBe(4);
    expect(r.stats.waitS).toEqual([0, 0]);
    expect(r.stats.waits).toEqual([1, 1]);
    // b's task arrives at 5 in the same instant the worker comes to rest there: it never queues.
    expect(r.stats.peakQueue).toEqual([0, 0]);
  });

  it("a covering worker's walk to a station counts as between-station walking", () => {
    // Same as the engine test: o1 a 0-1, carry 1-5, walk b->a 5-9 (4 m), o2/s0 9-10, carry 10-14,
    // o1/s1 14-15, o2/s1 15-16, walk home 16-20 (4 m). betweenM = 8.
    // Busy: work 1+1+1+1 = 4, carries 4+4 = 8, walks 4+4 = 8: 20 s.
    // Waits at a: o1/s0 0, o2/s0 ready 0.5 taken 5 -> 4.5. At b: o1/s1 ready 5 taken 14 -> 9; o2/s1 ready 14 taken 15 -> 1.
    const spec: KitSpec = { ...coveringKitchen(), orders: [{ orderId: "o1", itemId: "x", t: 0 }, { orderId: "o2", itemId: "x", t: 0.5 }] };
    const r = runOn(spec, exactCalibration({ a: 1, b: 1 }));
    expect(r.stats.betweenM).toBe(8);
    expect(r.stats.busyS).toEqual([20]);
    expect(r.stats.waitS).toEqual([4.5, 10]);
    expect(r.stats.waits).toEqual([2, 2]);
  });
});

describe("prediction metrics", () => {
  it("capacity kitchen: the station with the wait is the bottleneck", () => {
    // Per run: waits 0 and 3 at s, mean 1.5 s; peak queue 1.
    const p = predictOn(capacityKitchen(2, 1), exactCalibration({ s: 3 }), evenOrders(2, 0, "x"));
    expect(p.stations).toEqual([{ stationId: "s", meanWaitS: 1.5, peakQueue: 1 }]);
    expect(p.bottleneckStationId).toBe("s");
    // Each worker busy 3 s; o2 taps at 3 + 3 = 6, so the run lasts 6 s: 3 / 6 = 0.5.
    expect(p.workers).toEqual([{ workerId: "w1", busyShare: 0.5 }, { workerId: "w2", busyShare: 0.5 }]);
  });

  it("no bottleneck when every wait is under 0.5 s", () => {
    const p = predictOn(capacityKitchen(2), exactCalibration({ s: 3 }), evenOrders(2, 0, "x"));
    expect(p.stations).toEqual([{ stationId: "s", meanWaitS: 0, peakQueue: 0 }]);
    expect(p.bottleneckStationId).toBeNull();
  });

  it("one-worker chain, 2 s work, orders 10 s apart: busy share 6 / 22", () => {
    // Hand-off pickup: busy 2 s per order, 3 orders = 6 s. Last tap at 20 + 2 = 22.
    const p = predictOn(capacityKitchen(1), exactCalibration({ s: 2 }), evenOrders(3, 10, "x"));
    expect(p.workers).toHaveLength(1);
    expect(p.workers[0]!.workerId).toBe("w1");
    expect(p.workers[0]!.busyShare).toBeCloseTo(6 / 22, 12);
  });

  it("slow orders: the 0.9 quantile of a run's order times", () => {
    // D/D/1: service 5 s, arrivals every 3 s, 8 orders: times 5, 7, ..., 19.
    // Type-7 quantile: position 7 × 0.9 = 6.3, so 17 + 0.3 × (19 − 17) = 17.6.
    const p = predictOn(capacityKitchen(1), exactCalibration({ s: 5 }), evenOrders(8, 3, "x"));
    expect(p.slowOrderTime.p10).toBeCloseTo(17.6, 9);
    expect(p.slowOrderTime.p50).toBeCloseTo(17.6, 9);
    expect(p.slowOrderTime.p90).toBeCloseTo(17.6, 9);
  });

  it("covering worker: walking is an average and includes the walks between stations", () => {
    const spec = coveringKitchen();
    const layout = walkingPerOrder(buildKitchen(spec)).perOrderM;
    const p = predictOn(spec, exactCalibration({ a: 1, b: 1 }));
    expect(p.walkingIsAverage).toBe(true);
    expect(p.walkingPerOrderM).toBeGreaterThan(layout);
    // One order; the walk home is 4 m.
    expect(p.walkingPerOrderM).toBeCloseTo(layout + 4, 9);
  });
});

const FIXTURE = join(__dirname, "..", "..", "..", "fixtures", "counter-a");
const have = existsSync(join(FIXTURE, "taps.jsonl"));

describe.skipIf(!have)("counter-a metrics", () => {
  const jsonl = <T>(text: string): T[] =>
    text.split("\n").filter((l) => l.trim().length > 0).map((l) => JSON.parse(l) as { type: string }).filter((l) => l.type !== "header") as T[];

  it("fixed workers: walking is exact and unchanged", () => {
    const read = (f: string) => readFileSync(join(FIXTURE, f), "utf8");
    const setup = JSON.parse(read("setup.json")) as Setup;
    const world = resolveWorld(JSON.parse(read("scan.json")) as Scan, setup, JSON.parse(read("layout.json")) as Layout);
    const cal = calibrate(world, reconstructRun(setup, jsonl<TapEvent>(read("taps.jsonl"))), jsonl<PositionSample>(read("positions.jsonl")));
    const p = predict(world, cal, { reps: 20 });
    expect(p.walkingIsAverage).toBe(false);
    expect(p.walkingPerOrderM).toBe(walkingPerOrder(world).perOrderM);
    expect(p.workers.map((w) => w.workerId)).toEqual(world.workers.map((w) => w.id));
    expect(p.workers.every((w) => w.busyShare > 0 && w.busyShare <= 1)).toBe(true);
    expect(p.slowOrderTime.p50).toBeGreaterThanOrEqual(p.meanOrderTime.p10);
  });
});
