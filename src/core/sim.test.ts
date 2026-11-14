import { describe, expect, it } from "vitest";
import { resolveWorld } from "./world";
import { compileModel, SimError } from "./model";
import { runReplication } from "./sim";
import { queueAt } from "./timeline";
import type { Calibration } from "./calibrate";
import { evenOrders, fixedCalibration, kitLayout, kitScan, kitSetup, worker, type KitSpec } from "./testkit";
import type { WorkerDef } from "./types";


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
const build = (spec: KitSpec) => resolveWorld(kitScan(spec), kitSetup(spec), kitLayout(spec));
const run = (spec: KitSpec, cal: Calibration, releases: ReturnType<typeof evenOrders>, trace = false) =>
  runReplication(compileModel(build(spec), cal), releases, 7, 0, { trace });

describe("simulation, deterministic work and no walking", () => {
  const one = tandem([worker("a", "A"), worker("b", "B")]);

  it("uses each recipe's explicit time at shared stations without measured samples", () => {
    const spec: KitSpec = { ...one, menu: [
      { id: "espresso", name: "Espresso", steps: [{ stationId: "A", workSeconds: 10 }] },
      { id: "latte", name: "Latte", steps: [{ stationId: "A", workSeconds: 20 }] },
    ] };
    const releases = [
      { orderId: "one", itemId: "espresso", t: 0 },
      { orderId: "two", itemId: "latte", t: 100 },
    ];
    expect(run(spec, fixedCalibration({}), releases).orderTimes).toEqual([10, 20]);
  });

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

describe("simulation with walking", () => {
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

describe("random numbers", () => {
  const spec = tandem([worker("a", "A"), worker("b", "B")]);
  const cal = fixedCalibration({ A: [1, 2, 3, 4], B: [3, 5, 7, 9] });
  const orders = evenOrders(10, 2);

  it("same seed and replication give the same result; different ones differ", () => {
    const m = compileModel(build(spec), cal);
    expect(runReplication(m, orders, 3, 5)).toEqual(runReplication(m, orders, 3, 5));
    expect(runReplication(m, orders, 3, 6).orderTimes).not.toEqual(runReplication(m, orders, 3, 5).orderTimes);
  });

  it("uses common random numbers across layouts: same work time per order and step", () => {
    const near = compileModel(build(spec), cal);
    const farSpec: KitSpec = { ...spec, boxes: spec.boxes.map((b) => (b.id === "B" ? { ...b, x: 4 } : b)) };
    const far = compileModel(build(farSpec), cal);
    const workOf = (m: typeof near) =>
      runReplication(m, orders, 11, 2, { trace: true }).trace!.orders.flatMap((o) =>
        o.steps.map((s) => +((s.tapAt as number) - (s.startedAt as number)).toFixed(9)),
      );
    expect(workOf(far)).toEqual(workOf(near));
    // and the far layout really walks
    expect(runReplication(far, orders, 11, 2).lastFinish).toBeGreaterThan(runReplication(near, orders, 11, 2).lastFinish);
  });

  it("adding a worker keeps the same draws", () => {
    const base = compileModel(build(spec), cal);
    const more = compileModel(build(tandem([worker("a", "A"), worker("b", "B"), worker("b2", "B")])), cal);
    const work = (m: typeof base) =>
      runReplication(m, orders, 4, 1, { trace: true }).trace!.orders.map((o) => (o.steps[1]!.tapAt as number) - (o.steps[1]!.startedAt as number));
    expect(work(more)).toEqual(work(base));
  });
});

describe("model errors", () => {
  it("raises a clear error for a station with no samples or no worker", () => {
    const spec = tandem([worker("a", "A"), worker("b", "B")]);
    expect(() => compileModel(build(spec), fixedCalibration({ A: [1] }))).toThrow(SimError);
    expect(() => compileModel(build(spec), fixedCalibration({ A: [1] }))).toThrow(/No measured work times for "B"/);
    expect(() => compileModel(build(tandem([worker("a", "A")])), fixedCalibration({ A: [1], B: [1] }))).toThrow(/Nobody works at "B"/);
    expect(() => compileModel(build(spec), fixedCalibration({ A: [1], B: [1] }, 0))).toThrow(/speed/);
    const m = compileModel(build(spec), fixedCalibration({ A: [1], B: [1] }));
    expect(() => runReplication(m, [{ orderId: "x", itemId: "mocha", t: 0 }], 1, 0)).toThrow(/mocha/);
    expect(runReplication(m, [], 1, 0).lastFinish).toBe(0);
  });
});
