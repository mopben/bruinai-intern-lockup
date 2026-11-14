import { describe, expect, it } from "vitest";
import { resolveWorld } from "./world";
import { predict, simulateRun } from "./predict";
import { buildPathTable } from "./walking";
import { cafeKit, evenOrders, fixedCalibration, kitLayout, kitScan, kitSetup, worker, type KitSpec } from "./testkit";
import { exactCalibration, walledOffKitchen } from "./engine/test-kitchens";

const build = (spec: KitSpec) => resolveWorld(kitScan(spec), kitSetup(spec), kitLayout(spec));
const cafeCal = fixedCalibration({ order: [3, 4, 5, 4], make: [7, 9, 11, 8, 10], finish: [3, 4, 3.5] }, 1.2);

describe("predict", () => {
  it("collapses to the hand-computed value when work times are fixed", () => {
    const spec: KitSpec = {
      boxes: [
        { id: "A", x: 0, z: 0, role: "station" },
        { id: "B", x: 1, z: 0, role: "station" },
        { id: "P", x: 2, z: 0, role: "pickup" },
      ],
      menu: [{ id: "latte", name: "Latte", steps: [{ stationId: "A" }, { stationId: "B" }] }],
      workers: [worker("a", "A"), worker("b", "B")],
      orders: evenOrders(4, 1),
    };
    const p = predict(build(spec), fixedCalibration({ A: [2], B: [5] }), { reps: 20, byTime: 12 });
    // Order times 7, 11, 15, 19 (see the engine run test) -> mean 13; last finish 22; by 12 s two are done.
    expect(p.meanOrderTime).toEqual({ p10: 13, p50: 13, p90: 13 });
    expect(p.lastFinish).toEqual({ p10: 22, p50: 22, p90: 22 });
    expect(p.completedBy).toEqual({ t: 12, orders: { p10: 2, p50: 2, p90: 2 } });
    expect(p.walkingPerOrderM).toBe(0);
    expect(p.perOrderMean).toEqual([7, 11, 15, 19]);
    expect(p.assumption).toMatch(/pace we measured/);
  });

  it("says so when steps use typed times, and not otherwise", () => {
    const boxes = [
      { id: "A", x: 0, z: 0, role: "station" as const },
      { id: "B", x: 1, z: 0, role: "station" as const },
      { id: "P", x: 2, z: 0, role: "pickup" as const },
    ];
    const kit = (menu: KitSpec["menu"]): KitSpec => ({ boxes, menu, workers: [worker("a", "A"), worker("b", "B")], orders: evenOrders(2, 1) });
    const cal = fixedCalibration({ A: [2], B: [5] });
    const text = (menu: KitSpec["menu"]) => predict(build(kit(menu)), cal, { reps: 2 }).assumption;
    expect(text([{ id: "latte", name: "Latte", steps: [{ stationId: "A" }, { stationId: "B" }] }])).not.toMatch(/typed/);
    expect(text([{ id: "latte", name: "Latte", steps: [{ stationId: "A", workSeconds: 4 }, { stationId: "B" }] }])).toContain("1 step uses a time you typed, not a measured time.");
    expect(text([{ id: "latte", name: "Latte", steps: [{ stationId: "A", workSeconds: 4 }, { stationId: "B", workSeconds: 6 }] }])).toContain("2 steps use times you typed, not measured times.");
  });

  it("gives a real range with varied work times, and the same answer for the same seed", () => {
    const w = build(cafeKit());
    const a = predict(w, cafeCal);
    const b = predict(w, cafeCal);
    expect(a).toEqual(b);
    expect(a.meanOrderTime.p10).toBeLessThan(a.meanOrderTime.p90);
    expect(a.meanOrderTime.p10).toBeLessThanOrEqual(a.meanOrderTime.p50);
    expect(a.reps).toBe(200);
    expect(a.anyBlocked).toBe(false);
  });

  it("flags a covering worker walled off from its second station, though every menu walk has a path", () => {
    const w = build(walledOffKitchen());
    const p = predict(w, exactCalibration({ a: 1, b: 1, z: 1 }), { reps: 5 });
    expect(p.walking.anyBlocked).toBe(false);
    expect(p.anyBlocked).toBe(true);
  });

  it("moving the fridge next to Make cuts walking and order time", () => {
    const far = predict(build(cafeKit()), cafeCal);
    const near = predict(build(cafeKit({ x: -0.3, z: 0.1 })), cafeCal);
    expect(near.walkingPerOrderM).toBeLessThan(far.walkingPerOrderM - 2);
    expect(near.meanOrderTime.p50).toBeLessThan(far.meanOrderTime.p50);
  });

  it("a fourth worker at Make cuts order time without changing walking", () => {
    const three = predict(build(cafeKit()), cafeCal);
    const four = predict(build(cafeKit(undefined, 2)), cafeCal);
    expect(four.walkingPerOrderM).toBeCloseTo(three.walkingPerOrderM, 9);
    expect(four.meanOrderTime.p50).toBeLessThan(three.meanOrderTime.p50);
  });

  it("is fast enough for a drag: 10 orders x 200 reps well under 50 ms", () => {
    const spec = cafeKit();
    for (let i = 0; i < 5; i += 1) predict(build(spec), cafeCal); // warm up
    const runs = 20;
    const t0 = performance.now();
    for (let i = 0; i < runs; i += 1) predict(build(spec), cafeCal);
    const perCall = (performance.now() - t0) / runs;
    console.info(`[bench] resolve + predict, 10 orders x 200 reps: ${perCall.toFixed(2)} ms per call`);
    expect(perCall).toBeLessThan(50);
  });

  it("simulateRun gives a full trace the stage can animate", () => {
    const w = build(cafeKit());
    const trace = simulateRun(w, cafeCal, { rep: 3, table: buildPathTable(w) });
    expect(trace.orders).toHaveLength(10);
    expect(trace.orders.every((o) => o.completed)).toBe(true);
    const kinds = new Set(trace.movements.map((m) => m.kind));
    expect([...kinds].sort()).toEqual(["carry-back", "carry-out", "fetch-back", "fetch-out", "work"]);
    expect(trace.queue.stationIds).toEqual(["order", "make", "finish"]);
    expect(trace.endT).toBeGreaterThan(Math.max(...trace.orders.map((o) => o.finishedAt ?? 0)));
    expect(simulateRun(w, cafeCal, { rep: 3 })).toEqual(trace);
  });
});
