import { describe, expect, it } from "vitest";
import { taskKey } from "../calibrate";
import { walkingPerOrder } from "../walking";
import { queueAt } from "../timeline";
import { evenOrders, fixedCalibration, worker, type KitSpec } from "../testkit";
import type { Calibration } from "../calibrate";
import type { WorkerDef } from "../types";
import { compileEngineModel, oldestFirst, runEngine, SimError, type ReadyTask } from "./index";
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

// Cases moved from the old station-queue simulator's tests (sim.test.ts), numbers unchanged.

/** A -> B -> pickup, 1 m apart: every carry is a hand-off, no walking at all. */
function tandem(workers: readonly WorkerDef[], steps = [{ stationId: "A" }, { stationId: "B" }]): KitSpec {
  return {
    boxes: [
      { id: "A", x: 0, z: 0, role: "station" },
      { id: "B", x: 1, z: 0, role: "station" },
      { id: "P", x: 2, z: 0, role: "pickup" },
    ],
    menu: [{ id: "latte", name: "Latte", steps }],
    workers,
  };
}
const build = buildKitchen;
const run = (spec: KitSpec, cal: Calibration, releases: ReturnType<typeof evenOrders>, trace = false) =>
  runEngine(compileEngineModel(build(spec), cal), releases, 7, 0, { trace });

describe("station-queue cases, deterministic work and no walking", () => {
  const one = tandem([worker("a", "A"), worker("b", "B")]);

  it("matches hand-computed tandem-queue completion times", () => {
    // A takes 2 s, B 5 s. Releases 0,1,2,3. A done 2,4,6,8; B done 7,12,17,22.
    const r = run(one, fixedCalibration({ A: [2], B: [5] }), evenOrders(4, 1));
    expect(r.finishedAt).toEqual([7, 12, 17, 22]);
    expect(r.orderTimes).toEqual([7, 11, 15, 19]);
    expect(r.lastFinish).toBe(22);
  });

  it("a second worker at the bottleneck serves two at once", () => {
    const two = tandem([worker("a", "A"), worker("b1", "B"), worker("b2", "B")]);
    const r = run(two, fixedCalibration({ A: [2], B: [5] }), evenOrders(4, 1));
    // B: o1 2-7 (b1), o2 4-9 (b2), o3 7-12 (b1), o4 9-14 (b2)
    expect(r.finishedAt).toEqual([7, 9, 12, 14]);
  });

  it("halves the bottleneck's pace: 10 orders at once, A 1 s, B 5 s", () => {
    const cal = fixedCalibration({ A: [1], B: [5] });
    const all = evenOrders(10, 0);
    // One B worker: starts at 1, ten jobs of 5 s -> last at 51.
    expect(run(one, cal, all).lastFinish).toBe(51);
    // Two B workers: pairs finish at 6,7 / 11,12 / ... / 26,27 -> 2.5 s per order.
    const two = tandem([worker("a", "A"), worker("b1", "B"), worker("b2", "B")]);
    const r = run(two, cal, all);
    expect(r.lastFinish).toBe(27);
    expect(r.finishedAt).toEqual([6, 7, 11, 12, 16, 17, 21, 22, 26, 27]);
  });

  it("D/D/1: arrivals every 3 s, service 5 s, waits grow 2 s per order", () => {
    const t = tandem([worker("a", "A")], [{ stationId: "A" }]);
    const single: KitSpec = { ...t, boxes: t.boxes.map((b) => (b.id === "P" ? { ...b, x: 1 } : b.id === "B" ? { ...b, x: 5 } : b)) };
    const r = run(single, fixedCalibration({ A: [5] }), evenOrders(8, 3), true);
    expect(r.orderTimes).toEqual([5, 7, 9, 11, 13, 15, 17, 19]);
    // At 15.5 s: 6 arrived (0..15), 3 done (5,10,15) -> 3 tickets at A.
    expect(queueAt(r.trace!.queue, 15.5)).toEqual({ A: 3 });
    expect(r.trace!.movements.every((m) => m.kind === "work")).toBe(true);
  });
});

describe("station-queue cases with walking", () => {
  const spec: KitSpec = {
    boxes: [
      { id: "A", x: 0, z: 0, role: "station" },
      { id: "B", x: 3, z: 0, role: "station" },
      { id: "F", x: 6, z: 0, role: "storage" },
      { id: "P", x: 10, z: 0, role: "pickup" },
    ],
    menu: [{ id: "latte", name: "Latte", steps: [{ stationId: "A" }, { stationId: "B", fetchFrom: ["F"] }] }],
    workers: [worker("wa", "A"), worker("wb", "B")],
  };

  it("adds fetch and carry walks as the protocol says (same numbers as the calibration test)", () => {
    const r = run(spec, fixedCalibration({ A: [2], B: [3] }, 1.5), evenOrders(2, 1), true);
    expect(r.finishedAt[0]).toBeCloseTo(11, 9);
    expect(r.finishedAt[1]).toBeCloseTo(27 + 1 / 3, 9);
    const b1 = r.trace!.movements.filter((m) => m.orderId === "o1" && m.step === 1);
    expect(b1.map((m) => [m.kind, +m.t0.toFixed(4), +m.t1.toFixed(4)])).toEqual([
      ["fetch-out", 4, 6],
      ["fetch-back", 6, 8],
      ["work", 8, 11],
      ["carry-out", 11, 15.6667],
      ["carry-back", 15.6667, 20.3333],
    ]);
    expect(b1[0]?.path[0]?.x).toBeCloseTo(3);
    expect(b1[1]?.path[0]?.x).toBeCloseTo(6);
    const o2 = r.trace!.orders[1]!;
    expect(o2.steps.map((s) => [s.workerId, +(s.startedAt ?? 0).toFixed(4), +(s.tapAt ?? 0).toFixed(4)])).toEqual([
      ["wa", 6, 8],
      ["wb", 20.3333, 27.3333],
    ]);
  });
});

describe("station-queue cases, random numbers", () => {
  const spec = tandem([worker("a", "A"), worker("b", "B")]);
  const cal = fixedCalibration({ A: [1, 2, 3, 4], B: [3, 5, 7, 9] });
  const orders = evenOrders(10, 2);

  it("same seed and replication give the same result; different ones differ", () => {
    const m = compileEngineModel(build(spec), cal);
    expect(runEngine(m, orders, 3, 5)).toEqual(runEngine(m, orders, 3, 5));
    expect(runEngine(m, orders, 3, 6).orderTimes).not.toEqual(runEngine(m, orders, 3, 5).orderTimes);
  });

  it("uses common random numbers across layouts: same work time per order and step", () => {
    const near = compileEngineModel(build(spec), cal);
    const farSpec: KitSpec = { ...spec, boxes: spec.boxes.map((b) => (b.id === "B" ? { ...b, x: 4 } : b)) };
    const far = compileEngineModel(build(farSpec), cal);
    const workOf = (m: typeof near) =>
      runEngine(m, orders, 11, 2, { trace: true }).trace!.orders.flatMap((o) =>
        o.steps.map((s) => +((s.tapAt as number) - (s.startedAt as number)).toFixed(9)),
      );
    expect(workOf(far)).toEqual(workOf(near));
    // and the far layout really walks
    expect(runEngine(far, orders, 11, 2).lastFinish).toBeGreaterThan(runEngine(near, orders, 11, 2).lastFinish);
  });

  it("adding a worker keeps the same draws", () => {
    const base = compileEngineModel(build(spec), cal);
    const more = compileEngineModel(build(tandem([worker("a", "A"), worker("b", "B"), worker("b2", "B")])), cal);
    const work = (m: typeof base) =>
      runEngine(m, orders, 4, 1, { trace: true }).trace!.orders.map((o) => (o.steps[1]!.tapAt as number) - (o.steps[1]!.startedAt as number));
    expect(work(more)).toEqual(work(base));
  });
});

describe("station-queue cases, model errors", () => {
  it("raises a clear error for a station with no samples or no worker", () => {
    const spec = tandem([worker("a", "A"), worker("b", "B")]);
    expect(() => compileEngineModel(build(spec), fixedCalibration({ A: [1] }))).toThrow(SimError);
    expect(() => compileEngineModel(build(spec), fixedCalibration({ A: [1] }))).toThrow(/No measured work times for "B"/);
    expect(() => compileEngineModel(build(tandem([worker("a", "A")])), fixedCalibration({ A: [1], B: [1] }))).toThrow(/Nobody works at "B"/);
    expect(() => compileEngineModel(build(spec), fixedCalibration({ A: [1], B: [1] }, 0))).toThrow(/speed/);
    const m = compileEngineModel(build(spec), fixedCalibration({ A: [1], B: [1] }));
    expect(() => runEngine(m, [{ orderId: "x", itemId: "mocha", t: 0 }], 1, 0)).toThrow(/mocha/);
    expect(runEngine(m, [], 1, 0).lastFinish).toBe(0);
  });
});
