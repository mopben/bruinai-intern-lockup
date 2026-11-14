/**
 * Prediction: many simulated runs of a layout, summarised as ranges.
 */
import type { World } from "./world";
import type { Calibration } from "./calibrate";
import type { RunTrace } from "./trace";
import { buildPathTable, walkingPerOrder, type PathTable, type WalkingSummary } from "./walking";
import { compileModel, SimError } from "./model";
import { runReplication, type Releases } from "./sim";
import { mean, rangeOf, type Range } from "./stats";
import { walkExtrapolation, type WalkExtrapolation } from "./extrapolation";

export const DEFAULT_REPS = 200;
export const DEFAULT_SEED = 1;

export interface PredictOptions {
  /** Replications. Default DEFAULT_REPS. */
  readonly reps?: number;
  /** Default DEFAULT_SEED. Keep it fixed during a drag. */
  readonly seed?: number;
  /** Orders to simulate. Default: the setup's schedule. */
  readonly releases?: Releases;
  /** Also report how many orders are finished by this time (s). */
  readonly byTime?: number;
  /** Resample the measured work times in each replication. Default true. */
  readonly bootstrap?: boolean;
  /** Reuse paths already computed for this exact layout. */
  readonly table?: PathTable;
}

export interface Prediction {
  /** Mean order time of a run (release to last tap), p10/p50/p90 over replications. */
  readonly meanOrderTime: Range;
  /** When the last order is finished. */
  readonly lastFinish: Range;
  readonly completedBy: { readonly t: number; readonly orders: Range } | null;
  /** Exact walking per order, from the layout alone. */
  readonly walkingPerOrderM: number;
  readonly walking: WalkingSummary;
  /** Some walk had no path and used a straight line. */
  readonly anyBlocked: boolean;
  /** Mean over replications of each order's time, in the order of the releases. */
  readonly perOrderMean: readonly number[];
  readonly orderCount: number;
  readonly reps: number;
  readonly seed: number;
  /** Plain words, to show next to the numbers. Includes `extrapolation.note` when outside. */
  readonly assumption: string;
  /**
   * Walks in this layout shorter or longer than any measured. When `outside`, each
   * replication also draws which pace model to use, so the range includes that uncertainty.
   */
  readonly extrapolation: WalkExtrapolation;
}

function paceWords(cal: Calibration): string {
  const v = cal.walkSpeedMps.toFixed(1);
  switch (cal.paceMethod) {
    case "trip-fit":
      return `walking ${v} m/s plus ${cal.walkOverheadS.toFixed(1)} s per trip, from ${cal.walkSpeedSamples} measured trips`;
    case "trip-speed":
      return `walking ${v} m/s on average, from ${cal.walkSpeedSamples} measured trips`;
    case "windows":
      return `walking ${v} m/s, from moment-to-moment movement`;
    default:
      return `walking speed was not measured, so we assume ${v} m/s`;
  }
}

/** True when some station in the layout has more than one worker. */
export function hasSharedStation(world: World): boolean {
  const counts = new Map<string, number>();
  for (const w of world.workers) counts.set(w.stationId, (counts.get(w.stationId) ?? 0) + 1);
  return [...counts.values()].some((n) => n > 1);
}

/** The prediction's assumptions in plain words. */
export function assumptionText(cal: Calibration, reps: number, world?: World, extrapolation?: WalkExtrapolation): string {
  const shared = world !== undefined && hasSharedStation(world)
    ? " Two people at one station work side by side without getting in each other's way, and a new person works at the pace of the person already there."
    : "";
  return (
    `People work and walk at the pace we measured (${cal.sampleCount} timed steps; ${paceWords(cal)}). ` +
    `Only distances and staffing change.${shared}${extrapolation?.outside ? ` ${extrapolation.note}` : ""} The range is the middle 80% of ${reps} simulated runs.`
  );
}

/** Predict a run of this layout. Fast enough to call on every drag frame. */
export function predict(world: World, calibration: Calibration, opts: PredictOptions = {}): Prediction {
  const reps = Math.max(1, Math.floor(opts.reps ?? DEFAULT_REPS));
  const seed = opts.seed ?? DEFAULT_SEED;
  const releases = opts.releases ?? world.setup.schedule.orders;
  if (releases.length === 0) throw new SimError("This shift has no orders. Set its quantities in Orders.");
  const table = opts.table ?? buildPathTable(world);
  const model = compileModel(world, calibration, table);
  const walking = walkingPerOrder(world, table);
  const extrapolation = walkExtrapolation(world, calibration, table);
  const paceModels = extrapolation.outside ? "fit-or-speed" : "calibrated";
  const means: number[] = [];
  const lasts: number[] = [];
  const doneBy: number[] = [];
  const perOrderSum = new Float64Array(releases.length);
  for (let r = 0; r < reps; r += 1) {
    const rep = runReplication(model, releases, seed, r, { bootstrap: opts.bootstrap ?? true, paceModels });
    means.push(mean(rep.orderTimes));
    lasts.push(rep.lastFinish);
    rep.orderTimes.forEach((v, i) => {
      perOrderSum[i] = (perOrderSum[i] as number) + v;
    });
    if (opts.byTime !== undefined) {
      const by = opts.byTime;
      doneBy.push(rep.finishedAt.filter((f) => f <= by).length);
    }
  }
  return {
    meanOrderTime: rangeOf(means),
    lastFinish: rangeOf(lasts),
    completedBy: opts.byTime === undefined ? null : { t: opts.byTime, orders: rangeOf(doneBy) },
    walkingPerOrderM: walking.perOrderM,
    walking,
    anyBlocked: walking.anyBlocked,
    perOrderMean: Array.from(perOrderSum, (s) => s / reps),
    orderCount: releases.length,
    reps,
    seed,
    assumption: assumptionText(calibration, reps, world, extrapolation),
    extrapolation,
  };
}

export interface SimulateRunOptions {
  readonly seed?: number;
  /** Which replication to show. Same seed and rep on two layouts = same luck. */
  readonly rep?: number;
  readonly releases?: Releases;
  readonly bootstrap?: boolean;
  readonly table?: PathTable;
}

/** One simulated run with its full trace, for the stage to animate. */
export function simulateRun(world: World, calibration: Calibration, opts: SimulateRunOptions = {}): RunTrace {
  const table = opts.table ?? buildPathTable(world);
  const model = compileModel(world, calibration, table);
  const outside = walkExtrapolation(world, calibration, table).outside;
  const rep = runReplication(model, opts.releases ?? world.setup.schedule.orders, opts.seed ?? DEFAULT_SEED, opts.rep ?? 0, {
    bootstrap: opts.bootstrap ?? true,
    trace: true,
    paceModels: outside ? "fit-or-speed" : "calibrated",
  });
  return rep.trace as RunTrace;
}
