/**
 * Calibration: learn walking pace (pace.ts) and per-station work times from a run.
 * Uses only the tap log and the position log, never the fixture generator's settings.
 */
import type { PositionSample } from "./types";
import type { World } from "./world";
import type { RunReconstruction } from "./reconstruct";
import type { OrderTrace, StepTrace } from "./trace";
import { planItems, type ItemPlan, type StepPlan } from "./plan";
import { estimatePace, walkSeconds, type Pace, type PaceMethod } from "./pace";
import type { Trip } from "./trips";

export { DEFAULT_WALK_SPEED_MPS, estimateWalkSpeed, MOVING_THRESHOLD_MPS, SPEED_WINDOW_S, type SpeedEstimate } from "./speed";

/** Work-time samples are clamped up to this (a step cannot take no time). */
export const MIN_WORK_S = 0.5;

export interface Calibration {
  /** Walking speed (pace.speedMps). */
  readonly walkSpeedMps: number;
  /** Fixed time per walked round trip (pace.overheadS); 0 unless fitted from trips. */
  readonly walkOverheadS: number;
  /** How the pace was learned (see pace.ts). */
  readonly paceMethod: PaceMethod;
  /** Whole trips the pace was learned from; resampled per replication. Empty unless method is trip-*. */
  readonly paceTrips: readonly Trip[];
  /** True when no walking could be measured and DEFAULT_WALK_SPEED_MPS is used. */
  readonly walkSpeedAssumed: boolean;
  /** Trips used, or moving windows when the instantaneous fallback was used. */
  readonly walkSpeedSamples: number;
  /** Work time per step at each station (seconds), walking removed. */
  readonly workSamples: Readonly<Record<string, readonly number[]>>;
  readonly sampleCount: number;
  /** Samples that came out below MIN_WORK_S and were raised to it. */
  readonly clampedCount: number;
  /** Orders whose steps were used. */
  readonly orderIds: readonly string[];
  readonly warnings: readonly string[];
}

export interface CalibrationOptions {
  /** Only take work samples from these orders (queue state still uses every tap). */
  readonly orderIds?: ReadonlySet<string>;
}

interface StationStep {
  readonly order: OrderTrace;
  readonly step: StepTrace;
  readonly tap: number;
}

const isClean = (s: StepTrace | undefined): boolean => s !== undefined && s.tapAt !== null && s.tapAt === s.doneAt;

/** When the item physically reached this step's station, per the protocol, or null if unknown. */
function arrivalTime(order: OrderTrace, k: number, plan: ItemPlan, pace: Pace): number | null {
  if (k === 0) return order.releasedAt;
  const prev = order.steps[k - 1];
  if (!isClean(prev)) return null;
  const carry = plan.steps[k - 1]?.carry;
  return (prev?.tapAt as number) + (carry ? walkSeconds(pace, carry.oneWayM) : 0);
}

const fetchSeconds = (pace: Pace, sp: StepPlan): number => sp.fetchLegs.reduce((s, l) => s + 2 * walkSeconds(pace, l.oneWayM), 0);

/** Calibrate from a reconstructed run in the world it was recorded in. */
export function calibrate(
  world: World,
  run: RunReconstruction,
  positions: readonly PositionSample[],
  options: CalibrationOptions = {},
): Calibration {
  const est = estimatePace(world, positions);
  const pace = est.pace;
  const plans = planItems(world);
  const warnings: string[] = [...est.warnings];
  const samples: Record<string, number[]> = {};
  let clamped = 0;
  const used = new Set<string>();
  const stations = [...new Set(world.menu.flatMap((m) => m.steps.map((s) => s.stationId)))];
  for (const stationId of stations) {
    samples[stationId] = [];
    const workers = world.workers.filter((w) => w.stationId === stationId).map((w) => w.id);
    const freeAt = new Map<string, number>(workers.map((id) => [id, -Infinity]));
    const steps: StationStep[] = run.orders
      .flatMap((order) => order.steps.filter((s) => s.stationId === stationId && s.tapAt !== null).map((step) => ({ order, step, tap: step.tapAt as number })))
      .sort((a, b) => a.tap - b.tap);
    for (const { order, step, tap } of steps) {
      const plan = plans.get(order.itemId);
      const sp = plan?.steps[step.step];
      if (!plan || !sp) continue;
      const wid = step.workerId !== null && freeAt.has(step.workerId)
        ? step.workerId
        : [...freeAt.entries()].reduce<[string, number] | null>((best, e) => (best === null || e[1] < best[1] ? e : best), null)?.[0];
      const arrival = arrivalTime(order, step.step, plan, pace);
      const take = options.orderIds === undefined || options.orderIds.has(order.orderId);
      if (wid !== undefined && arrival !== null && isClean(step) && take) {
        const start = Math.max(arrival, freeAt.get(wid) as number);
        const work = tap - start - fetchSeconds(pace, sp);
        if (work < MIN_WORK_S) clamped += 1;
        (samples[stationId] as number[]).push(Math.max(work, MIN_WORK_S));
        used.add(order.orderId);
      }
      if (wid !== undefined) freeAt.set(wid, tap + 2 * walkSeconds(pace, sp.carry.oneWayM));
    }
    if (workers.length === 0) warnings.push(`No worker was at "${stationId}" in this layout.`);
    if ((samples[stationId] as number[]).length === 0) warnings.push(`No usable work times at "${stationId}".`);
  }
  const sampleCount = Object.values(samples).reduce((n, s) => n + s.length, 0);
  return {
    walkSpeedMps: pace.speedMps,
    walkOverheadS: pace.overheadS,
    paceMethod: est.method,
    paceTrips: est.trips,
    walkSpeedAssumed: est.method === "assumed",
    walkSpeedSamples: est.samples,
    workSamples: samples,
    sampleCount,
    clampedCount: clamped,
    orderIds: run.orders.map((o) => o.orderId).filter((id) => used.has(id)),
    warnings,
  };
}
