import { describe, expect, it } from "vitest";
import type { PositionSample } from "./types";
import { resolveWorld } from "./world";
import { bootstrapPace, fitLine, paceFromTrips, supportsFit, walkSeconds, type Pace } from "./pace";
import { detectTrips, type Trip } from "./trips";
import { mulberry32 } from "./rng";
import { predict, simulateRun } from "./predict";
import { cafeKit, fixedCalibration, kitLayout, kitScan, kitSetup, type KitSpec } from "./testkit";
import type { Calibration } from "./calibrate";

const trip = (group: string, distanceM: number, durationS: number): Trip => ({
  workerId: "w",
  kind: group.startsWith("fetch") ? "fetch" : "carry",
  targetId: group.split(":")[1] as string,
  group,
  t0: 0,
  t1: durationS,
  distanceM,
  durationS,
});

// duration = 1 + d / 1.5, with a little noise, two groups.
const trips: readonly Trip[] = [
  trip("fetch:F", 6, 5.1), trip("fetch:F", 6, 4.9), trip("fetch:F", 6, 5.2), trip("fetch:F", 6, 4.8),
  trip("carry:P", 12, 9.1), trip("carry:P", 12, 8.9), trip("carry:P", 12, 9.3), trip("carry:P", 12, 8.7),
];

describe("pace helpers", () => {
  it("walkSeconds splits the overhead across the two directions and is 0 for no walk", () => {
    const p: Pace = { speedMps: 1.5, overheadS: 1 };
    expect(walkSeconds(p, 3)).toBeCloseTo(2.5);
    expect(walkSeconds(p, 0)).toBe(0);
  });

  it("fits a line, refuses degenerate data, and clamps a negative overhead", () => {
    const f = fitLine(trips)!;
    expect(f.a).toBeCloseTo(1, 6);
    expect(1 / f.b).toBeCloseTo(1.5, 6);
    expect(supportsFit(trips)).toBe(true);
    expect(supportsFit(trips.slice(0, 4))).toBe(false);
    expect(fitLine(trips.slice(0, 4))).toBeNull();
    const negative = [trip("fetch:F", 2, 1), trip("fetch:F", 2, 1), trip("carry:P", 10, 9), trip("carry:P", 10, 9)];
    const clamped = paceFromTrips(negative, "trip-fit");
    expect(clamped.overheadS).toBe(0);
    expect(clamped.speedMps).toBeCloseTo((4 + 100) / (2 + 90), 9);
  });

  it("bootstrap resamples within groups, repeatably, and keeps non-trip paces fixed", () => {
    const base = paceFromTrips(trips, "trip-fit");
    const a = bootstrapPace(trips, "trip-fit", base, mulberry32(9));
    const b = bootstrapPace(trips, "trip-fit", base, mulberry32(9));
    expect(a).toEqual(b);
    const draws = Array.from({ length: 50 }, (_, i) => bootstrapPace(trips, "trip-fit", base, mulberry32(i)).speedMps);
    expect(Math.max(...draws)).toBeGreaterThan(Math.min(...draws));
    expect(bootstrapPace(trips, "windows", base, mulberry32(1))).toBe(base);
    expect(bootstrapPace([], "trip-speed", base, mulberry32(1))).toBe(base);
    expect(bootstrapPace(trips, "trip-speed", base, mulberry32(1)).overheadS).toBe(0);
  });
});

describe("trip detection edge cases", () => {
  const spec = cafeKit();
  const world = resolveWorld(kitScan(spec), kitSetup(spec), kitLayout(spec));
  const home = world.itemsById.get("make")!.stand;
  it("drops an excursion that never comes home and one that reaches no known stand point", () => {
    const pos: PositionSample[] = [
      { type: "pos", t: 0, workerId: "blue", x: home.x, z: home.z },
      { type: "pos", t: 1, workerId: "blue", x: home.x + 1, z: home.z + 1 }, // nowhere in particular
      { type: "pos", t: 2, workerId: "blue", x: home.x, z: home.z },
      { type: "pos", t: 3, workerId: "blue", x: home.x + 2, z: home.z }, // leaves and the log ends
    ];
    expect(detectTrips(world, pos)).toEqual([]);
  });
});

describe("pace uncertainty in predictions", () => {
  const spec = cafeKit();
  const world = resolveWorld(kitScan(spec), kitSetup(spec), kitLayout(spec));
  const work = { order: [3, 4, 5, 4], make: [7, 9, 11, 8, 10], finish: [3, 4, 3.5] };
  const noisyTrips: readonly Trip[] = [
    trip("fetch:fridge", 4, 4.0), trip("fetch:fridge", 4, 5.6), trip("fetch:fridge", 4, 4.4), trip("fetch:fridge", 4, 6.0),
    trip("carry:make", 3, 3.0), trip("carry:make", 3, 4.4), trip("carry:make", 3, 3.4), trip("carry:make", 3, 4.0),
  ];
  const withTrips = (): Calibration => {
    const p = paceFromTrips(noisyTrips, "trip-speed");
    return { ...fixedCalibration(work, p.speedMps), paceMethod: "trip-speed", paceTrips: noisyTrips, walkSpeedSamples: noisyTrips.length };
  };

  it("bootstrapping the trips widens the range", () => {
    const cal = withTrips();
    const fixedPace = predict(world, { ...cal, paceTrips: [], paceMethod: "windows" });
    const drawnPace = predict(world, cal);
    const width = (p: typeof fixedPace) => p.meanOrderTime.p90 - p.meanOrderTime.p10;
    expect(width(drawnPace)).toBeGreaterThan(width(fixedPace));
    expect(drawnPace.assumption).toMatch(/from 8 measured trips/);
  });

  it("each replication's pace is the same on every layout (common random numbers)", () => {
    const cal = withTrips();
    const far = world;
    const nearSpec: KitSpec = cafeKit({ x: -0.3, z: 0.1 });
    const near = resolveWorld(kitScan(nearSpec), kitSetup(nearSpec), kitLayout(nearSpec));
    const speedOf = (w: typeof world, rep: number): number => {
      const seg = simulateRun(w, cal, { rep }).movements.find((m) => m.kind === "carry-out")!;
      const len = Math.hypot(seg.path[1]!.x - seg.path[0]!.x, seg.path[1]!.z - seg.path[0]!.z);
      return len / (seg.t1 - seg.t0);
    };
    expect(speedOf(near, 4)).toBeCloseTo(speedOf(far, 4), 9);
    expect(speedOf(far, 4)).not.toBeCloseTo(speedOf(far, 5), 6);
  });

  it("states the side-by-side assumption only when a station is shared", () => {
    const cal = fixedCalibration(work);
    expect(predict(world, cal, { reps: 5 }).assumption).not.toMatch(/side by side/);
    const four = cafeKit(undefined, 2);
    const w4 = resolveWorld(kitScan(four), kitSetup(four), kitLayout(four));
    expect(predict(w4, cal, { reps: 5 }).assumption).toMatch(/Two people at one station work side by side without getting in each other's way, and a new person works at the pace of the person already there\./);
  });

  it("describes each pace method in plain words", () => {
    const base = fixedCalibration(work);
    const text = (c: Calibration) => predict(world, c, { reps: 2 }).assumption;
    expect(text({ ...base, paceMethod: "trip-fit", walkOverheadS: 0.8, walkSpeedSamples: 12 })).toMatch(/plus 0.8 s per trip, from 12 measured trips/);
    expect(text(base)).toMatch(/moment-to-moment/);
    expect(text({ ...base, paceMethod: "assumed", walkSpeedAssumed: true })).toMatch(/not measured/);
  });
});
