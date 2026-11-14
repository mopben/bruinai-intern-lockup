import { describe, expect, it } from "vitest";
import { resolveWorld } from "./world";
import { walkExtrapolation } from "./extrapolation";
import { predict } from "./predict";
import { compileEngineModel, runEngine } from "./engine/index";
import { walkingForItem } from "./walking";
import { walkCheck } from "./walkcheck";
import { rangeOf, mean } from "./stats";
import { cafeKit, fixedCalibration, kitLayout, kitScan, kitSetup, type KitSpec } from "./testkit";
import type { Calibration } from "./calibrate";
import type { Trip } from "./trips";

const build = (spec: KitSpec) => resolveWorld(kitScan(spec), kitSetup(spec), kitLayout(spec));
const original = build(cafeKit());
const work = { order: [3, 4, 5, 4], make: [7, 9, 11, 8, 10], finish: [3, 4, 3.5] };

/** Trips on every walk of the original layout: duration = 2 + RT / 1.2, with +-0.3 s scatter. */
function tripsOn(world: typeof original, perGroup = 4): Trip[] {
  const legs = walkingForItem(world, "latte").legs.filter((l) => l.roundTripM > 0);
  return legs.flatMap((l) =>
    Array.from({ length: perGroup }, (_, i) => {
      const durationS = 2 + l.roundTripM / 1.2 + (i % 2 === 0 ? 0.3 : -0.3);
      return { workerId: "w", kind: l.kind, targetId: l.toId, group: `${l.kind}:${l.toId}`, t0: 0, t1: durationS, distanceM: l.roundTripM, durationS };
    }),
  );
}
function calWith(trips: readonly Trip[]): Calibration {
  return { ...fixedCalibration(work, 1.2), walkOverheadS: 2, paceMethod: "trip-fit", paceTrips: trips, walkSpeedSamples: trips.length };
}
const cal = calWith(tripsOn(original));
const nearSpec = cafeKit({ x: -0.3, z: 0.1 });
const near = build(nearSpec);

describe("walk extrapolation", () => {
  it("is inside for the layout the trips were measured in", () => {
    const x = walkExtrapolation(original, cal);
    expect(x.outside).toBe(false);
    expect(x.note).toBe("");
    expect(x.measuredRangeM).not.toBeNull();
    expect(predict(original, cal, { reps: 10 }).extrapolation.outside).toBe(false);
  });

  it("says so in plain words when a walk is shorter than any measured", () => {
    const x = walkExtrapolation(near, cal);
    expect(x.outside).toBe(true);
    expect(x.walks.map((w) => [w.kind, w.toId, w.side])).toContainEqual(["fetch", "fridge", "shorter"]);
    expect(x.note).toContain("The walk to the fridge is shorter than any walk we measured, so its time is less certain.");
    const p = predict(near, cal, { reps: 10 });
    expect(p.extrapolation.outside).toBe(true);
    expect(p.assumption).toContain("shorter than any walk we measured");
  });

  it("says longer, names both ends for a carry, and is silent without measured trips", () => {
    const far: KitSpec = { ...cafeKit(), boxes: cafeKit().boxes.map((b) => (b.id === "pickup" ? { ...b, x: 1.9, z: 2.6 } : b)) };
    const x = walkExtrapolation(build(far), calWith(tripsOn(original).filter((t) => t.group !== "carry:pickup")));
    expect(x.note).toMatch(/The walk from finish to pickup is longer than any walk we measured/);
    expect(walkExtrapolation(near, fixedCalibration(work))).toEqual({ outside: false, note: "", measuredRangeM: null, walks: [] });
  });

  it("widens the range when extrapolating, by drawing the pace model per replication, without flicker", () => {
    const m = compileEngineModel(near, cal);
    const orders = near.setup.schedule.orders;
    const meansFor = (mode: "calibrated" | "fit-or-speed") =>
      Array.from({ length: 200 }, (_, r) => mean(runEngine(m, orders, 1, r, { paceModels: mode }).orderTimes));
    const width = (xs: number[]) => rangeOf(xs).p90 - rangeOf(xs).p10;
    expect(width(meansFor("fit-or-speed"))).toBeGreaterThan(width(meansFor("calibrated")));
    expect(meansFor("fit-or-speed")).toEqual(meansFor("fit-or-speed"));
  });
});

describe("walk check", () => {
  it("is near zero on trips that follow the pace model, and moves when walking error is injected", () => {
    const clean = walkCheck(cal).check!;
    expect(clean.trips).toBe(cal.paceTrips.length);
    expect(clean.maeS).toBeLessThan(0.45);
    // Every other trip takes a second longer than the pace model says (an irregular walking error).
    const noisy = cal.paceTrips.map((t, i) => (i % 2 === 0 ? { ...t, durationS: t.durationS + 1 } : t));
    const hit = walkCheck(calWith(noisy)).check!;
    expect(hit.maeS).toBeGreaterThan(clean.maeS + 0.3);
    expect(hit.mapePct).toBeGreaterThan(clean.mapePct);
  });

  it("leave-one-group-out sees an error confined to one kind of walk", () => {
    const clean = walkCheck(cal).check!;
    const fridgeSlow = cal.paceTrips.map((t) => (t.group === "fetch:fridge" ? { ...t, durationS: t.durationS + 1.5 } : t));
    const hit = walkCheck(calWith(fridgeSlow)).check!;
    const g = (c: typeof clean) => c.byGroup.find((x) => x.group === "fetch:fridge")!.errorS;
    expect(Math.abs(g(hit) - g(clean))).toBeGreaterThan(1.2);
  });

  it("gives a reason instead of a number when it cannot check", () => {
    expect(walkCheck(fixedCalibration(work)).reason).toMatch(/No whole walking trips/);
    expect(walkCheck(calWith(cal.paceTrips.slice(0, 3))).reason).toMatch(/Only 3 walking trips/);
    const oneGroup = calWith(cal.paceTrips.filter((t) => t.group === "fetch:fridge").concat(cal.paceTrips.filter((t) => t.group === "fetch:fridge")));
    expect(walkCheck({ ...oneGroup, paceMethod: "trip-speed" }).check?.byGroup).toEqual([]);
  });
});
