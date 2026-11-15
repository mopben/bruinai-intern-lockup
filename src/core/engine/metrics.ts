/**
 * Metrics over many replications: slow orders, busy share per worker, waiting per station,
 * the bottleneck, and the walks between stations of covering workers. Pure aggregation of
 * each replication's `stats`; uses no random numbers. Mutable sums live only inside the
 * accumulator; nothing passed in is changed.
 */
import { quantile, rangeOf, type Range } from "../stats";
import type { EngineModel } from "./model";
import type { Replication } from "./run";

/** Order time that 9 in 10 orders of a run beat. */
export const SLOW_ORDER_QUANTILE = 0.9;
/** A station is named as the bottleneck only when its mean wait reaches this (s). */
export const BOTTLENECK_MIN_WAIT_S = 0.5;

export interface WorkerMetric {
  readonly workerId: string;
  /** Busy seconds (walking + working) inside the run, over the run's last finish; mean over runs. At most 1. */
  readonly busyShare: number;
}

export interface StationMetric {
  readonly stationId: string;
  /** Mean over runs of the run's mean wait (assigned − ready) at this station. */
  readonly meanWaitS: number;
  /** Mean over runs of the most tasks ready and unassigned at once. */
  readonly peakQueue: number;
}

export interface RunMetrics {
  readonly slowOrderTime: Range;
  readonly workers: readonly WorkerMetric[];
  readonly stations: readonly StationMetric[];
  readonly bottleneckStationId: string | null;
  /** True when some worker covers several stations: walking then includes walks between them. */
  readonly walkingIsAverage: boolean;
  /** Mean over runs of metres walked between stations per order. */
  readonly betweenPerOrderM: number;
}

export interface MetricsAccumulator {
  readonly add: (rep: Replication) => void;
  readonly finish: () => RunMetrics;
}

/** The station with the largest mean wait, or null when every wait is under the threshold. */
export function bottleneckOf(stations: readonly StationMetric[]): string | null {
  let best: StationMetric | null = null;
  for (const s of stations) if (s.meanWaitS >= BOTTLENECK_MIN_WAIT_S && (best === null || s.meanWaitS > best.meanWaitS)) best = s;
  return best?.stationId ?? null;
}

/** Collect replications one at a time (so `predict` need not keep them) and summarise. */
export function metricsAccumulator(model: EngineModel, orderCount: number): MetricsAccumulator {
  const W = model.workers.length;
  const S = model.stationIds.length;
  const slow: number[] = [];
  const share = new Float64Array(W);
  const wait = new Float64Array(S);
  const peak = new Float64Array(S);
  let between = 0;
  const add = (rep: Replication): void => {
    const st = rep.stats;
    slow.push(rep.orderTimes.length > 0 ? quantile(rep.orderTimes, SLOW_ORDER_QUANTILE) : 0);
    for (let w = 0; w < W; w += 1) share[w] = (share[w] as number) + (rep.lastFinish > 0 ? (st.busyS[w] as number) / rep.lastFinish : 0);
    for (let s = 0; s < S; s += 1) {
      const n = st.waits[s] as number;
      wait[s] = (wait[s] as number) + (n > 0 ? (st.waitS[s] as number) / n : 0);
      peak[s] = (peak[s] as number) + (st.peakQueue[s] as number);
    }
    between += orderCount > 0 ? st.betweenM / orderCount : 0;
  };
  const finish = (): RunMetrics => {
    const n = Math.max(1, slow.length);
    const workers = model.workers.map((w, i) => ({ workerId: w.id, busyShare: (share[i] as number) / n }));
    const stations = model.stationIds.map((id, s) => ({ stationId: id, meanWaitS: (wait[s] as number) / n, peakQueue: (peak[s] as number) / n }));
    return {
      slowOrderTime: rangeOf(slow),
      workers,
      stations,
      bottleneckStationId: bottleneckOf(stations),
      walkingIsAverage: model.workers.some((w) => w.roams),
      betweenPerOrderM: between / n,
    };
  };
  return { add, finish };
}
