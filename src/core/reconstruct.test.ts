import { describe, expect, it } from "vitest";
import type { TapEvent } from "./types";
import { reconstructRun } from "./reconstruct";
import { peakQueue, queueAt, ticketsAt } from "./timeline";
import { kitSetup, worker, type KitSpec } from "./testkit";

const spec: KitSpec = {
  boxes: [
    { id: "A", x: 0, z: 0, role: "station" },
    { id: "B", x: 3, z: 0, role: "station" },
    { id: "P", x: 6, z: 0, role: "pickup" },
  ],
  menu: [{ id: "latte", name: "Latte", steps: [{ stationId: "A" }, { stationId: "B" }] }],
  workers: [worker("w1", "A"), worker("w2", "B")],
  orders: [
    { orderId: "o1", itemId: "latte", t: 0 },
    { orderId: "o2", itemId: "latte", t: 2 },
    { orderId: "o3", itemId: "latte", t: 4 },
  ],
};
const setup = kitSetup(spec);
const order = (orderId: string, t: number): TapEvent => ({ type: "order", orderId, itemId: "latte", t });
const done = (orderId: string, step: number, t: number, stationId = step === 0 ? "A" : "B"): TapEvent => ({ type: "done", orderId, step, t, stationId });

const clean: readonly TapEvent[] = [
  order("o1", 0), order("o2", 2), order("o3", 4),
  done("o1", 0, 3), done("o1", 1, 8),
  done("o2", 0, 6), done("o2", 1, 13),
  done("o3", 0, 9), done("o3", 1, 18),
  { type: "end", t: 20 },
];

describe("reconstructRun", () => {
  it("gives release, taps and order times for a clean log", () => {
    const r = reconstructRun(setup, clean);
    expect(r.warnings).toEqual([]);
    expect(r.orders.map((o) => o.orderTime)).toEqual([8, 11, 14]);
    expect(r.orders[1]?.steps.map((s) => [s.arrivedAt, s.tapAt, s.doneAt])).toEqual([[2, 6, 6], [6, 13, 13]]);
    expect(r.endT).toBe(20);
  });

  it("builds a queue timeline that counts tickets at each station", () => {
    const { queue } = reconstructRun(setup, clean);
    expect(queueAt(queue, 1)).toEqual({ A: 1, B: 0 });
    expect(queueAt(queue, 5)).toEqual({ A: 2, B: 1 }); // o2,o3 at A; o1 done at B at 8
    expect(queueAt(queue, 10)).toEqual({ A: 0, B: 2 }); // o2 (6..13), o3 (9..18)
    expect(queueAt(queue, 19)).toEqual({ A: 0, B: 0 });
    expect(ticketsAt(queue, "B", 10)).toEqual(["o2", "o3"]);
    expect(peakQueue(queue)).toEqual({ A: 2, B: 2 });
  });

  it("tolerates shuffled, duplicate, unknown and missing taps without throwing", () => {
    const messy: TapEvent[] = [
      done("o3", 1, 18), order("o3", 4), done("o2", 0, 6), done("o2", 0, 6.4),
      order("o1", 0), done("ghost", 0, 5), done("o1", 7, 5), done("o1", 1, 8), // o1 step 0 missing
      order("o2", 2), done("o2", 1, 13, "A"), done("o3", 0, 3.9), done("o3", 0, 9),
      order("o2", 2.5), { type: "order", orderId: "x", itemId: "mocha", t: 1 }, { type: "done", orderId: "o1", step: 0, t: Number.NaN, stationId: "A" },
    ];
    const r = reconstructRun(setup, messy);
    const text = r.warnings.join("\n");
    expect(text).toMatch(/Duplicate tap for order "o2"/);
    expect(text).toMatch(/unknown order "ghost"/);
    expect(text).toMatch(/step 7/);
    expect(text).toMatch(/before its release/);
    expect(text).toMatch(/came from "A", expected "B"/);
    expect(text).toMatch(/released twice/);
    expect(text).toMatch(/mocha/);
    expect(text).toMatch(/no valid time/);
    const o1 = r.orders[0]!;
    expect(o1.steps[0]).toMatchObject({ tapAt: null, doneAt: 8 });
    expect(o1.orderTime).toBe(8);
    expect(r.orders.map((o) => o.orderTime)).toEqual([8, 11, 14]);
    expect(r.endT).toBe(18);
  });

  it("lets a later tap decide when an earlier step was done", () => {
    const r = reconstructRun(setup, [order("o1", 0), done("o1", 1, 5), done("o1", 0, 7)]);
    expect(r.orders[0]?.steps.map((s) => s.doneAt)).toEqual([5, 5]);
    expect(r.warnings.join()).toMatch(/out of sequence/);
    expect(queueAt(r.queue, 4)).toEqual({ A: 1, B: 0 });
  });

  it("marks unfinished orders and keeps their tickets open to the end", () => {
    const r = reconstructRun(setup, [order("o1", 0), order("o2", 2), done("o1", 0, 3), { type: "end", t: 10 }]);
    expect(r.orders.map((o) => [o.completed, o.orderTime])).toEqual([[false, null], [false, null]]);
    expect(queueAt(r.queue, 9.9)).toEqual({ A: 1, B: 1 });
    expect(r.queue.intervals.find((i) => i.orderId === "o1" && i.step === 1)?.to).toBeNull();
  });

  describe("a join", () => {
    const joinSetup = kitSetup({
      ...spec,
      boxes: [...spec.boxes, { id: "C", x: 0, z: 3, role: "station" }],
      menu: [{
        id: "latte",
        name: "Latte",
        steps: [{ stationId: "A" }, { stationId: "B" }, { stationId: "C" }],
        tasks: [{ id: "p", stationId: "A" }, { id: "q", stationId: "B" }, { id: "r", stationId: "C", after: ["p", "q"] }],
      }],
    });
    const tap = (step: number, t: number): TapEvent => ({ type: "done", orderId: "o1", step, t, stationId: ["A", "B", "C"][step] ?? "A" });

    it("starts a joined task when its last input is done", () => {
      const r = reconstructRun(joinSetup, [order("o1", 0), tap(0, 3), tap(1, 5), tap(2, 9)]);
      expect(r.warnings).toEqual([]);
      expect(r.orders[0]?.steps.map((s) => [s.arrivedAt, s.doneAt])).toEqual([[0, 3], [0, 5], [5, 9]]);
      expect(r.orders[0]?.orderTime).toBe(9);
      expect(queueAt(r.queue, 4)).toEqual({ A: 0, B: 1, C: 0 });
      expect(queueAt(r.queue, 6)).toEqual({ A: 0, B: 0, C: 1 });
    });

    it("lets the joined task's tap prove both inputs done", () => {
      const r = reconstructRun(joinSetup, [order("o1", 0), tap(0, 3), tap(2, 9)]);
      expect(r.orders[0]?.steps.map((s) => [s.arrivedAt, s.doneAt])).toEqual([[0, 3], [0, 9], [9, 9]]);
    });

    it("warns about a tap for a task that does not exist and does not throw", () => {
      const r = reconstructRun(joinSetup, [order("o1", 0), tap(7, 2), tap(0, 3), tap(1, 5), tap(2, 9)]);
      expect(r.warnings.join()).toMatch(/step 7/);
      expect(r.orders[0]?.orderTime).toBe(9);
    });
  });

  it("falls back to the schedule for releases", () => {
    const noOrders = reconstructRun(setup, [done("o1", 0, 1), done("o1", 1, 2), { type: "end", t: 3 }]);
    expect(noOrders.orders.map((o) => o.orderId)).toEqual(["o1", "o2"]);
    expect(noOrders.warnings.join()).toMatch(/no order events/);
    const partial = reconstructRun(setup, [order("o1", 0), done("o2", 0, 5)]);
    expect(partial.orders.map((o) => [o.orderId, o.releasedAt])).toEqual([["o1", 0], ["o2", 2]]);
    expect(partial.warnings.join()).toMatch(/no order event/);
    expect(reconstructRun(setup, []).orders).toEqual([]);
  });
});
