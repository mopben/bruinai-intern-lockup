/**
 * Trust check: is the model any good on orders it did not learn from?
 * Calibrate on even-indexed orders (by release), simulate the whole run with the
 * real release times, and compare mean order time on the odd-indexed orders.
 */
import type { PositionSample, TapEvent } from "./types";
import type { World } from "./world";
import { reconstructRun, type RunReconstruction } from "./reconstruct";
import { calibrate, type Calibration } from "./calibrate";
import { predict, DEFAULT_REPS, DEFAULT_SEED } from "./predict";
import { mean } from "./stats";

/** Fewer held-out finished orders than this and the error number is flagged as shaky. */
export const MIN_CHECK_ORDERS = 3;

export interface TrustPair {
  readonly orderId: string;
  readonly measuredS: number;
  readonly modelS: number;
}

export interface TrustResult {
  /** (model - measured) / measured x 100 on held-out orders. null when it cannot be computed. */
  readonly errorPct: number | null;
  readonly measuredMeanS: number | null;
  readonly modelMeanS: number | null;
  readonly pairs: readonly TrustPair[];
  readonly calibratedOn: readonly string[];
  readonly checkedOn: readonly string[];
  readonly method: string;
  /** Why the number may be shaky, in plain words; null when there is no concern. */
  readonly caveat: string | null;
  readonly calibration: Calibration | null;
  readonly run: RunReconstruction;
}

export interface TrustOptions {
  readonly reps?: number;
  readonly seed?: number;
}

const METHOD =
  "We learned work times from every other order (1st, 3rd, 5th...), then replayed the whole run in the model " +
  "with the real order times and compared the orders it never saw (2nd, 4th, 6th...).";

function failed(run: RunReconstruction, caveat: string, cal: Calibration | null, calibratedOn: readonly string[], checkedOn: readonly string[]): TrustResult {
  return { errorPct: null, measuredMeanS: null, modelMeanS: null, pairs: [], calibratedOn, checkedOn, method: METHOD, caveat, calibration: cal, run };
}

/** Run the trust check on a recorded run, in the world (layout) it was recorded in. */
export function trustCheck(world: World, taps: readonly TapEvent[], positions: readonly PositionSample[], opts: TrustOptions = {}): TrustResult {
  const run = reconstructRun(world.setup, taps);
  const learn = run.orders.filter((_, i) => i % 2 === 0).map((o) => o.orderId);
  const held = run.orders.filter((_, i) => i % 2 === 1);
  const checkedOn = held.filter((o) => o.completed).map((o) => o.orderId);
  if (run.orders.length < 2) return failed(run, "Not enough orders to check: need at least two orders.", null, learn, []);
  const cal = calibrate(world, run, positions, { orderIds: new Set(learn) });
  const missing = Object.entries(cal.workSamples).filter(([, s]) => s.length === 0).map(([id]) => world.itemsById.get(id)?.name ?? id);
  if (missing.length > 0) return failed(run, `No timed steps to learn from at ${missing.join(", ")}.`, cal, learn, checkedOn);
  if (checkedOn.length === 0) return failed(run, "None of the held-out orders finished, so there is nothing to compare.", cal, learn, []);
  const releases = run.orders.map((o) => ({ orderId: o.orderId, itemId: o.itemId, t: o.releasedAt }));
  const pred = predict(world, cal, { releases, reps: opts.reps ?? DEFAULT_REPS, seed: opts.seed ?? DEFAULT_SEED });
  const index = new Map(run.orders.map((o, i) => [o.orderId, i] as const));
  const pairs: TrustPair[] = held
    .filter((o) => o.completed)
    .map((o) => ({ orderId: o.orderId, measuredS: o.orderTime as number, modelS: pred.perOrderMean[index.get(o.orderId) as number] as number }));
  const measuredMeanS = mean(pairs.map((p) => p.measuredS));
  const modelMeanS = mean(pairs.map((p) => p.modelS));
  const notes: string[] = [];
  if (pairs.length < MIN_CHECK_ORDERS) notes.push(`Only ${pairs.length} held-out order${pairs.length === 1 ? "" : "s"} to compare, so this number is rough.`);
  const unfinished = held.length - pairs.length;
  if (unfinished > 0) notes.push(`${unfinished} held-out order${unfinished === 1 ? " was" : "s were"} not finished and ${unfinished === 1 ? "is" : "are"} left out.`);
  if (cal.walkSpeedAssumed) notes.push("Walking speed was not measured and is assumed.");
  return {
    errorPct: ((modelMeanS - measuredMeanS) / measuredMeanS) * 100,
    measuredMeanS,
    modelMeanS,
    pairs,
    calibratedOn: learn,
    checkedOn,
    method: METHOD,
    caveat: notes.length > 0 ? notes.join(" ") : null,
    calibration: cal,
    run,
  };
}
