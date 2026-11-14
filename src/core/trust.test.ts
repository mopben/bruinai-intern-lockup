import { describe, expect, it } from "vitest";
import type { TapEvent } from "./types";
import { resolveWorld } from "./world";
import { simulateRun } from "./predict";
import { trustCheck } from "./trust";
import { cafeKit, evenOrders, fixedCalibration, kitLayout, kitScan, kitSetup, traceToPositions, traceToTaps } from "./testkit";

const spec = { ...cafeKit(), orders: evenOrders(16, 8) };
const world = resolveWorld(kitScan(spec), kitSetup(spec), kitLayout(spec));
const truthCal = fixedCalibration({ order: [3, 3.5, 4, 5, 4.5], make: [3, 4, 5, 6, 4.5, 5.5], finish: [3, 3.5, 4] }, 1.3);
const truth = simulateRun(world, truthCal, { seed: 4242, rep: 0, bootstrap: false });
const home = new Map(world.workers.map((w) => [w.id, world.itemsById.get(w.stationId)!.stand] as const));
const taps = traceToTaps(truth);
const positions = traceToPositions(truth, home, 10);

describe("trustCheck", () => {
  it("on a run made by the model itself the error is small", () => {
    const r = trustCheck(world, taps, positions);
    expect(r.calibratedOn).toHaveLength(8);
    expect(r.checkedOn).toHaveLength(8);
    expect(r.pairs.map((p) => p.orderId)).toEqual(["o2", "o4", "o6", "o8", "o10", "o12", "o14", "o16"]);
    // The simulated trace starts and stops instantly (not physical), so rest-to-rest timing reads it as slower.
    expect(r.calibration?.paceMethod).toMatch(/^trip-/);
    expect(Math.abs(r.errorPct as number)).toBeLessThan(10);
    expect(r.caveat).toBeNull();
    expect(r.method).toMatch(/never saw/);
  });

  it("when held-out orders really were slower the error is large (it is a real comparison)", () => {
    // Orders a minute apart so they do not queue. Even orders come from a run with fast Make
    // work, odd (held-out) orders from a run where Make took three times as long.
    const spaced = { ...spec, orders: evenOrders(10, 60) };
    const w = resolveWorld(kitScan(spaced), kitSetup(spaced), kitLayout(spaced));
    const slowCal = fixedCalibration({ ...truthCal.workSamples, make: truthCal.workSamples.make!.map((v) => 3 * v) }, 1.3);
    const fast = traceToTaps(simulateRun(w, truthCal, { seed: 1, bootstrap: false }));
    const slow = traceToTaps(simulateRun(w, slowCal, { seed: 1, bootstrap: false }));
    const odd = (id: string): boolean => Number(id.slice(1)) % 2 === 0; // o2, o4, ... are 2nd, 4th, ...
    const pick = (e: TapEvent): boolean => e.type === "end" || odd(e.orderId) === false;
    const mixed = [...fast.filter(pick), ...slow.filter((e) => e.type !== "end" && odd(e.orderId))];
    const honest = trustCheck(w, fast, positions);
    const r = trustCheck(w, mixed, positions);
    expect(Math.abs(honest.errorPct as number)).toBeLessThan(12);
    expect(r.errorPct as number).toBeLessThan(-30);
  });

  it("says so when there are few orders, and gives no number when it cannot", () => {
    const few = trustCheck(world, taps.filter((e) => e.type !== "done" || ["o1", "o2", "o3"].includes(e.orderId)).filter((e) => e.type !== "order" || ["o1", "o2", "o3"].includes(e.orderId)), positions);
    expect(few.errorPct).not.toBeNull();
    expect(few.caveat).toMatch(/Only 1 held-out order/);
    const one = trustCheck(world, taps.filter((e) => e.type === "order" ? e.orderId === "o1" : e.type !== "done" || e.orderId === "o1"), positions);
    expect(one.errorPct).toBeNull();
    expect(one.caveat).toMatch(/at least two/);
  });

  it("gives no number when a station has nothing to learn from, or no held-out order finished", () => {
    const noMake = taps.filter((e) => !(e.type === "done" && e.stationId === "make" && ["o1", "o3", "o5", "o7", "o9", "o11", "o13", "o15"].includes(e.orderId)));
    const r = trustCheck(world, noMake, positions);
    expect(r.errorPct).toBeNull();
    expect(r.caveat).toMatch(/No timed steps to learn from at make/);
    const unfinished = taps.filter((e) => !(e.type === "done" && e.step === 2 && Number(e.orderId.slice(1)) % 2 === 0));
    const u = trustCheck(world, unfinished, []);
    expect(u.errorPct).toBeNull();
    expect(u.caveat).toMatch(/None of the held-out orders finished/);
  });

  it("notes unfinished held-out orders and an assumed walking speed", () => {
    const r = trustCheck(world, taps.filter((e) => !(e.type === "done" && e.orderId === "o16")), []);
    expect(r.checkedOn).toHaveLength(7);
    expect(r.caveat).toMatch(/1 held-out order was not finished[\s\S]*assumed/);
  });

  it("reports the trivial baseline, the walking check and the scope alongside the headline", () => {
    const r = trustCheck(world, taps, positions);
    // Baseline: every held-out order guessed at the learned orders' mean order time.
    const learned = r.run.orders.filter((_, i) => i % 2 === 0).map((o) => o.orderTime as number);
    const guess = learned.reduce((a, b) => a + b, 0) / learned.length;
    expect(r.baselineErrorPct).toBeCloseTo(((guess - (r.measuredMeanS as number)) / (r.measuredMeanS as number)) * 100, 9);
    expect(r.scope).toMatch(/layout that was run[\s\S]*walking check/);
    expect(r.walkCheck === null ? r.walkCheckReason : r.walkCheck.trips).toBeTruthy();
    const none = trustCheck(world, taps, []);
    expect(none.walkCheck).toBeNull();
    expect(none.walkCheckReason).toMatch(/No whole walking trips/);
    const one = trustCheck(world, taps.filter((e) => e.type === "end" || e.orderId === "o1"), positions);
    expect(one.baselineErrorPct).toBeNull();
    expect(one.walkCheckReason).toMatch(/Nothing was learned/);
  });
});
