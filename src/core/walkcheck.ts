/**
 * Walking check: does the pace model predict trips it was not fitted on?
 *
 * Leave-one-trip-out: for each detected trip, fit the pace on the others (same
 * rules as calibration) and predict its duration. Also leave-one-group-out:
 * predict a whole kind of walk (e.g. every fetch from the fridge) from the other
 * kinds only, which is the closer test of a walk of a new length.
 *
 * The order-time trust check cannot see walking error in the recorded layout
 * (it is absorbed into work times); this check can.
 */
import type { Calibration } from "./calibrate";
import { MIN_TRIPS, paceFromTrips, supportsFit, type Pace } from "./pace";
import type { Trip } from "./trips";
import { mean } from "./stats";

export interface GroupCheck {
  readonly group: string;
  readonly trips: number;
  readonly measuredMeanS: number;
  readonly predictedS: number;
  /** predicted - measured, seconds. */
  readonly errorS: number;
}

export interface WalkCheck {
  /** Trips checked. */
  readonly trips: number;
  /** Mean |predicted - measured| trip duration, leave-one-trip-out. */
  readonly maeS: number;
  /** The same as a percent of each trip's duration (mean). */
  readonly mapePct: number;
  /** Each kind of walk predicted from the other kinds only (empty with fewer than two kinds). */
  readonly byGroup: readonly GroupCheck[];
}

export interface WalkCheckResult {
  readonly check: WalkCheck | null;
  /** Why there is no check, in plain words; null when there is one. */
  readonly reason: string | null;
}

function refit(trips: readonly Trip[], fitted: boolean): Pace {
  return paceFromTrips(trips, fitted && supportsFit(trips) ? "trip-fit" : "trip-speed");
}

const predictTrip = (p: Pace, t: Trip): number => p.overheadS + t.distanceM / p.speedMps;

export function walkCheck(cal: Calibration): WalkCheckResult {
  const trips = cal.paceTrips;
  if (cal.paceMethod !== "trip-fit" && cal.paceMethod !== "trip-speed") {
    return { check: null, reason: "No whole walking trips were found, so walking could not be checked." };
  }
  if (trips.length < MIN_TRIPS + 1) {
    return { check: null, reason: `Only ${trips.length} walking trips; at least ${MIN_TRIPS + 1} are needed to check walking.` };
  }
  const fitted = cal.paceMethod === "trip-fit";
  const errs = trips.map((t, i) => {
    const p = refit(trips.filter((_, j) => j !== i), fitted);
    return { abs: Math.abs(predictTrip(p, t) - t.durationS), pct: (Math.abs(predictTrip(p, t) - t.durationS) / t.durationS) * 100 };
  });
  const groups = [...new Set(trips.map((t) => t.group))].sort();
  const byGroup: GroupCheck[] =
    groups.length < 2
      ? []
      : groups.map((g) => {
          const inG = trips.filter((t) => t.group === g);
          const p = refit(trips.filter((t) => t.group !== g), fitted);
          const predictedS = mean(inG.map((t) => predictTrip(p, t)));
          const measuredMeanS = mean(inG.map((t) => t.durationS));
          return { group: g, trips: inG.length, measuredMeanS, predictedS, errorS: predictedS - measuredMeanS };
        });
  return {
    check: { trips: trips.length, maeS: mean(errs.map((e) => e.abs)), mapePct: mean(errs.map((e) => e.pct)), byGroup },
    reason: null,
  };
}
