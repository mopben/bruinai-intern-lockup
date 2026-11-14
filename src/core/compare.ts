/**
 * Measured-run summaries and checking a prediction against a measured run.
 */
import type { RunTrace } from "./trace";
import type { Range } from "./stats";
import { mean } from "./stats";
import { formatGapSeconds } from "./format";

const missText = (side: "below" | "above" | null, s: number): string =>
  side === null ? "inside the predicted range" : `${formatGapSeconds(s)} ${side} the range`;

export interface MeasuredSummary {
  /** Mean order time over finished orders; null when none finished. */
  readonly meanOrderTimeS: number | null;
  readonly lastFinishS: number | null;
  readonly completed: number;
  readonly total: number;
}

/** Summary of a recorded (or simulated) run, the numbers a prediction is checked against. */
export function summariseRun(run: RunTrace): MeasuredSummary {
  const done = run.orders.filter((o) => o.completed);
  return {
    meanOrderTimeS: done.length > 0 ? mean(done.map((o) => o.orderTime as number)) : null,
    lastFinishS: done.length > 0 ? Math.max(...done.map((o) => o.finishedAt as number)) : null,
    completed: done.length,
    total: run.orders.length,
  };
}

export interface PredictionCheck {
  /** Measured value within [p10, p90]. */
  readonly inside: boolean;
  /** "below" the range, "above" it, or null when inside. */
  readonly side: "below" | "above" | null;
  /** Seconds outside the nearest edge; 0 when inside. */
  readonly missByS: number;
  /** missByS as a percent of the nearest edge. */
  readonly missByPct: number;
  /** Measured minus predicted median, seconds. */
  readonly offMedianS: number;
  /** Plain words: "inside the predicted range", "0.3 s above the range", "under 0.1 s below the range". */
  readonly missText: string;
}

/** Was the measured value inside the predicted p10-p90 range, and if not, by how much did it miss? */
export function checkPrediction(predicted: Range, measured: number): PredictionCheck {
  const offMedianS = measured - predicted.p50;
  if (measured < predicted.p10) {
    const missByS = predicted.p10 - measured;
    return { inside: false, side: "below", missByS, missByPct: (missByS / predicted.p10) * 100, offMedianS, missText: missText("below", missByS) };
  }
  if (measured > predicted.p90) {
    const missByS = measured - predicted.p90;
    return { inside: false, side: "above", missByS, missByPct: (missByS / predicted.p90) * 100, offMedianS, missText: missText("above", missByS) };
  }
  return { inside: true, side: null, missByS: 0, missByPct: 0, offMedianS, missText: missText(null, 0) };
}
