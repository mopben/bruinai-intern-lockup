/**
 * Walking pace: how long a modelled walk takes.
 *
 * The model only uses pace to turn a path length into a duration, so it is
 * learned from whole trips timed rest to rest (trips.ts) against the full
 * modelled round-trip distance, so speeding up, stopping, turning round and
 * reaching into the fridge are all included.
 *
 * - "trip-fit": trips of clearly different lengths, so fit
 *   duration = overhead + distance / speed (least squares). `overheadS` is per round trip.
 * - "trip-speed": trips all about one length (or the fit was not sensible):
 *   one effective speed, the median of distance / duration, no overhead.
 * - "windows": no usable trips; the instantaneous estimator (speed.ts).
 * - "assumed": not enough walking at all; DEFAULT_WALK_SPEED_MPS.
 */
import type { PositionSample } from "./types";
import type { World } from "./world";
import type { Rng } from "./rng";
import { detectTrips, type Trip } from "./trips";
import { estimateWalkSpeed } from "./speed";
import { mean, median } from "./stats";

export interface Pace {
  readonly speedMps: number;
  /** Fixed time per round trip (s), split evenly between the two directions. */
  readonly overheadS: number;
}

export type PaceMethod = "trip-fit" | "trip-speed" | "windows" | "assumed";

/** Fewer matched trips than this: use the instantaneous estimator. */
export const MIN_TRIPS = 4;
/** A fit needs two trip groups whose mean lengths differ by at least this. */
export const FIT_MIN_SPREAD_M = 1.0;
/** ...and at least this many trips in each of those two groups. */
export const FIT_MIN_PER_GROUP = 2;

export interface PaceEstimate {
  readonly pace: Pace;
  readonly method: PaceMethod;
  readonly trips: readonly Trip[];
  /** Trips used, or moving windows for "windows". */
  readonly samples: number;
  readonly warnings: readonly string[];
}

/** Seconds to walk one way along `oneWayM` (0 when there is nothing to walk). */
export function walkSeconds(pace: Pace, oneWayM: number): number {
  return oneWayM > 0 ? pace.overheadS / 2 + oneWayM / pace.speedMps : 0;
}

function groupMeans(trips: readonly Trip[]): ReadonlyMap<string, { readonly n: number; readonly d: number }> {
  const by = new Map<string, Trip[]>();
  for (const t of trips) by.set(t.group, [...(by.get(t.group) ?? []), t]);
  return new Map([...by].map(([g, ts]) => [g, { n: ts.length, d: mean(ts.map((t) => t.distanceM)) }] as const));
}

/** Do the trips have two well-populated groups of clearly different length? */
export function supportsFit(trips: readonly Trip[]): boolean {
  const ds = [...groupMeans(trips).values()].filter((g) => g.n >= FIT_MIN_PER_GROUP).map((g) => g.d);
  return ds.length >= 2 && Math.max(...ds) - Math.min(...ds) >= FIT_MIN_SPREAD_M;
}

/** Least-squares duration = a + b * distance. null when degenerate. */
export function fitLine(trips: readonly Trip[]): { readonly a: number; readonly b: number } | null {
  const xs = trips.map((t) => t.distanceM);
  const ys = trips.map((t) => t.durationS);
  const mx = mean(xs);
  const my = mean(ys);
  let sxx = 0;
  let sxy = 0;
  xs.forEach((x, i) => {
    sxx += (x - mx) ** 2;
    sxy += (x - mx) * ((ys[i] as number) - my);
  });
  if (!(sxx > 1e-12)) return null;
  const b = sxy / sxx;
  return { a: my - b * mx, b };
}

export function effectiveSpeed(trips: readonly Trip[]): Pace {
  return { speedMps: median(trips.map((t) => t.distanceM / t.durationS)), overheadS: 0 };
}

/** Pace from trips by the given method; for "trip-fit" a non-sensible fit is clamped (overhead 0, line through origin). */
export function paceFromTrips(trips: readonly Trip[], method: "trip-fit" | "trip-speed"): Pace {
  if (method === "trip-speed") return effectiveSpeed(trips);
  const f = fitLine(trips);
  if (f && f.b > 0 && f.a >= 0) return { speedMps: 1 / f.b, overheadS: f.a };
  const sdt = trips.reduce((s, t) => s + t.distanceM * t.durationS, 0);
  const sdd = trips.reduce((s, t) => s + t.distanceM * t.distanceM, 0);
  return { speedMps: sdd / sdt, overheadS: 0 };
}

/** Estimate pace from the position log of a run recorded in `world`. */
export function estimatePace(world: World, positions: readonly PositionSample[]): PaceEstimate {
  const trips = detectTrips(world, positions).filter((t) => t.distanceM > 0 && t.durationS > 0);
  if (trips.length < MIN_TRIPS) {
    const w = estimateWalkSpeed(positions);
    const why = `Only ${trips.length} whole walking trip${trips.length === 1 ? "" : "s"} found in the position log`;
    return w.assumed
      ? { pace: { speedMps: w.mps, overheadS: 0 }, method: "assumed", trips: [], samples: 0, warnings: [`${why}; walking speed assumed ${w.mps} m/s.`] }
      : { pace: { speedMps: w.mps, overheadS: 0 }, method: "windows", trips: [], samples: w.samples, warnings: [`${why}; walking speed taken from moment-to-moment movement instead.`] };
  }
  if (supportsFit(trips)) {
    const f = fitLine(trips);
    if (f && f.b > 0 && f.a >= 0) {
      return { pace: { speedMps: 1 / f.b, overheadS: f.a }, method: "trip-fit", trips, samples: trips.length, warnings: [] };
    }
    return { pace: effectiveSpeed(trips), method: "trip-speed", trips, samples: trips.length, warnings: ["Trip times did not fit a fixed overhead plus speed; one effective walking pace used."] };
  }
  return { pace: effectiveSpeed(trips), method: "trip-speed", trips, samples: trips.length, warnings: ["Walking trips were all about the same length; one effective walking pace used."] };
}

/** Shortest and longest round trip measured, or null when the pace did not come from trips. */
export function tripDistanceRange(trips: readonly Trip[]): { readonly min: number; readonly max: number } | null {
  if (trips.length === 0) return null;
  const ds = trips.map((t) => t.distanceM);
  return { min: Math.min(...ds), max: Math.max(...ds) };
}

/** Bootstrap the pace: resample trips within each group (keeps the length spread), refit by the same method. */
export function bootstrapPace(trips: readonly Trip[], method: PaceMethod, base: Pace, rng: Rng): Pace {
  if ((method !== "trip-fit" && method !== "trip-speed") || trips.length === 0) return base;
  const groups = [...new Set(trips.map((t) => t.group))].sort();
  const resampled = groups.flatMap((g) => {
    const ts = trips.filter((t) => t.group === g);
    return ts.map(() => ts[Math.floor(rng() * ts.length)] as Trip);
  });
  return paceFromTrips(resampled, method);
}
