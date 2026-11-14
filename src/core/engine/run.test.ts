import { describe, expect, it } from "vitest";
import { taskKey } from "../calibrate";
import { SimError } from "../model";
import { walkingPerOrder } from "../walking";
import { evenOrders, worker, type KitSpec } from "../testkit";
import type { Calibration } from "../calibrate";
import { compileEngineModel, oldestFirst, runEngine, type ReadyTask } from "./index";
import { buildKitchen, capacityKitchen, coveringKitchen, exactCalibration, joinKitchen, twoItemKitchen, walledOffKitchen } from "./test-kitchens";

const exact = { bootstrap: false, trace: true } as const;
const runOn = (spec: KitSpec, cal: Calibration, releases = spec.orders ?? []) => runEngine(compileEngineModel(buildKitchen(spec), cal), releases, 1, 0, exact);
const taps = (r: ReturnType<typeof runOn>) => r.trace!.orders.map((o) => o.steps.map((s) => s.tapAt));

describe("engine, known answers", () => {
  it("join: r waits for both p and q", () => {
    // p at a: 0-2. q at b: 0-5. Hand-offs, so r is ready at 5 and taps at 6.
    const r = runOn(joinKitchen(), exactCalibration({ a: 2, b: 5, c: 1 }));
    expect(r.orderTimes).toEqual([6]);
    expect(taps(r)).toEqual([[2, 5, 6]]);
    expect(r.trace!.orders[0]!.steps[2]!.arrivedAt).toBe(5);
  });

  it("two items with different routes use their own task pools", () => {
    // o1 (A): a 0-2, then b (A/s1 takes 3). o2 (B): b (B/s0 takes 4) at 0-4.
    // wb is busy until 4, so o1 at b runs 4-7. b's station pool (9 s) is never used.
    const cal = exactCalibration({ a: 2, b: 9 }, { [taskKey("A", "s1")]: 3, [taskKey("B", "s0")]: 4 });
    const r = runOn(twoItemKitchen(), cal);
    expect(r.finishedAt).toEqual([7, 4]);
    expect(taps(r)).toEqual([[2, 7], [4]]);
  });

  it("a covering worker carries, works at the drop point, and walks home", () => {
    // a 0-1; carry 4 m at 1 m/s: 1-5; the worker rests at b and works there 5-6;
    // the pickup is a hand-off, nothing else to do, so it walks home 6-10.
    const r = runOn(coveringKitchen(), exactCalibration({ a: 1, b: 1 }));
    expect(taps(r)).toEqual([[1, 6]]);
    expect(r.trace!.orders[0]!.steps.map((s) => s.workerId)).toEqual(["w", "w"]);
    const moves = r.trace!.movements.map((m) => [m.kind, m.t0, m.t1]);
    expect(moves).toEqual([
      ["work", 0, 1],
      ["carry-out", 1, 5],
      ["work", 5, 6],
      ["walk", 6, 10],
    ]);
    const home = r.trace!.movements[3]!;
    expect(home.path[0]!.x).toBeCloseTo(4, 9);
    expect(home.path[home.path.length - 1]!.x).toBeCloseTo(0, 9);
  });

  it("a covering worker walks to a task at a station it is not at", () => {
    // Two orders: the second's task at a is ready at 0.5 while the worker is at b after the first carry.
    const spec: KitSpec = { ...coveringKitchen(), orders: [{ orderId: "o1", itemId: "x", t: 0 }, { orderId: "o2", itemId: "x", t: 0.5 }] };
    const r = runOn(spec, exactCalibration({ a: 1, b: 1 }));
    // o1: a 0-1, carry 1-5, at b both o1/s1 (ready 5) and o2/s0 (ready 0.5) are ready;
    // oldest first: o2/s0 at a. Walk b->a 5-9, work 9-10, carry 10-14; at b o1/s1 (ready 5) then o2/s1.
    expect(taps(r)).toEqual([[1, 15], [10, 16]]);
    expect(r.trace!.movements.filter((m) => m.kind === "walk").map((m) => [m.t0, m.t1])).toEqual([
      [5, 9],
      [16, 20],
    ]);
  });

  it("a station at capacity makes a ready task wait", () => {
    const releases = evenOrders(2, 0, "x");
    const cal = exactCalibration({ s: 3 });
    expect(taps(runOn(capacityKitchen(2, 1), cal, releases))).toEqual([[3], [6]]);
    expect(taps(runOn(capacityKitchen(2), cal, releases))).toEqual([[3], [3]]);
  });

  it("terminates with every order finished when workers outnumber the room", () => {
    const r = runOn(capacityKitchen(3, 1), exactCalibration({ s: 3 }), evenOrders(10, 0, "x"));
    expect(r.finishedAt).toHaveLength(10);
    expect(r.finishedAt.every((t) => Number.isFinite(t))).toBe(true);
    expect(r.lastFinish).toBe(30);
  });

  it("is deterministic in its arguments", () => {
    const m = compileEngineModel(buildKitchen(twoItemKitchen()), exactCalibration({ a: 2, b: 9 }));
    const rel = [...evenOrders(5, 1, "A"), ...evenOrders(5, 1.5, "B")].map((o, i) => ({ ...o, orderId: `o${i}` }));
    expect(runEngine(m, rel, 3, 2, { trace: true })).toEqual(runEngine(m, rel, 3, 2, { trace: true }));
  });
});

describe("engine model errors", () => {
  it("names a station nobody covers", () => {
    const spec = joinKitchen([worker("wa", "a"), worker("wc", "c")]);
    const compile = () => compileEngineModel(buildKitchen(spec), exactCalibration({ a: 1, b: 1, c: 1 }));
    expect(compile).toThrow(SimError);
    expect(compile).toThrow('Nobody works at "b". Put at least one worker there.');
  });

  it("names a station with no work samples, and rejects unknown items", () => {
    expect(() => compileEngineModel(buildKitchen(joinKitchen()), exactCalibration({ a: 1, c: 1 }))).toThrow(/No measured work times for "b"/);
    const m = compileEngineModel(buildKitchen(joinKitchen()), exactCalibration({ a: 1, b: 1, c: 1 }));
    expect(() => runEngine(m, [{ orderId: "o", itemId: "mocha", t: 0 }], 1, 0)).toThrow(/mocha/);
    expect(runEngine(m, [], 1, 0).lastFinish).toBe(0);
  });

  it("flags a covering walk that has no path, and still runs", () => {
    const w = buildKitchen(walledOffKitchen());
    expect(walkingPerOrder(w).anyBlocked).toBe(false);
    const m = compileEngineModel(w, exactCalibration({ a: 1, b: 1, z: 1 }));
    expect(m.anyBlocked).toBe(true);
    const r = runEngine(m, walledOffKitchen().orders!, 1, 0, exact);
    expect(r.finishedAt.every((t) => Number.isFinite(t))).toBe(true);
    expect(r.trace!.orders[0]!.steps[0]!.workerId).toBe("w1");
  });

  it("does not flag a kitchen whose walks all have paths", () => {
    expect(compileEngineModel(buildKitchen(coveringKitchen()), exactCalibration({ a: 1, b: 1 })).anyBlocked).toBe(false);
  });
});

describe("oldest-first rule", () => {
  const task = (job: number, stationId: string, readyAt: number, seq: number, walkM: number): ReadyTask => ({ job, stationId, readyAt, seq, walkM });
  const w = { id: "w", homeId: "h", atId: "h" };

  it("takes the task ready longest, then home, then nearest, then first ready", () => {
    expect(oldestFirst(w, [], 0)).toBeNull();
    expect(oldestFirst(w, [task(1, "h", 2, 0, 0), task(2, "o", 1, 1, 5)], 3)).toBe(2);
    expect(oldestFirst(w, [task(1, "o", 1, 0, 0), task(2, "h", 1, 1, 5)], 3)).toBe(2);
    expect(oldestFirst(w, [task(1, "o", 1, 0, 3), task(2, "p", 1, 1, 2)], 3)).toBe(2);
    expect(oldestFirst(w, [task(1, "h", 1, 4, 0), task(2, "h", 1, 3, 0)], 3)).toBe(2);
  });
});
