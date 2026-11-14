/**
 * Calibration: learn walking speed and per-station work times from a run.
 * Uses only the tap log and the position log, never the fixture generator's settings.
 */
import type { PositionSample } from "./types";
import type { World } from "./world";
import type { RunReconstruction } from "./reconstruct";
import type { OrderTrace, StepTrace } from "./trace";
import { planItems, type ItemPlan } from "./plan";
import { median } from "./stats";

/** Walking speed used when there is no usable position log. Stated in the UI as assumed. */
export const DEFAULT_WALK_SPEED_MPS = 1.2;
/** Displacement is measured over this window to beat position noise. */
export const SPEED_WINDOW_S = 0.5;
/** Window speeds below this count as standing, not walking. */
export const MOVING_THRESHOLD_MPS = 0.4;
/** Gaps in the position log longer than this are not bridged. */
export const MAX_POSITION_GAP_S = 2;
/** Fewer moving windows than this: fall back to the default speed. */
export const MIN_SPEED_SAMPLES = 5;
/** Work-time samples are clamped up to this (a step cannot take no time). */
export const MIN_WORK_S = 0.5;

export interface SpeedEstimate {
  readonly mps: number;
  /** True when the default was used because the position log had too little walking. */
  readonly assumed: boolean;
  readonly samples: number;
}

export interface Calibration {
  readonly walkSpeedMps: number;
  readonly walkSpeedAssumed: boolean;
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

function windowSpeeds(samples: readonly PositionSample[]): number[] {
  const out: number[] = [];
  let j = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const a = samples[i] as PositionSample;
    if (j <= i) j = i + 1;
    while (j < samples.length && (samples[j] as PositionSample).t - a.t < SPEED_WINDOW_S) j += 1;
    const b = samples[j];
    if (!b) break;
    const dt = b.t - a.t;
    if (dt > MAX_POSITION_GAP_S) continue;
    out.push(Math.hypot(b.x - a.x, b.z - a.z) / dt);
  }
  return out;
}

/** Robust walking speed: median of windowed speeds above the movement threshold, across workers. */
export function estimateWalkSpeed(positions: readonly PositionSample[]): SpeedEstimate {
  const byWorker = new Map<string, PositionSample[]>();
  for (const p of positions) {
    if (!Number.isFinite(p.t) || !Number.isFinite(p.x) || !Number.isFinite(p.z)) continue;
    const list = byWorker.get(p.workerId) ?? [];
    list.push(p);
    byWorker.set(p.workerId, list);
  }
  const moving = [...byWorker.values()]
    .flatMap((list) => windowSpeeds([...list].sort((a, b) => a.t - b.t)))
    .filter((v) => v > MOVING_THRESHOLD_MPS);
  if (moving.length < MIN_SPEED_SAMPLES) return { mps: DEFAULT_WALK_SPEED_MPS, assumed: true, samples: moving.length };
  return { mps: median(moving), assumed: false, samples: moving.length };
}

interface StationStep {
  readonly order: OrderTrace;
  readonly step: StepTrace;
  readonly tap: number;
}

const isClean = (s: StepTrace | undefined): boolean => s !== undefined && s.tapAt !== null && s.tapAt === s.doneAt;

/** When the item physically reached this step's station, per the protocol, or null if unknown. */
function arrivalTime(order: OrderTrace, k: number, plan: ItemPlan, speed: number): number | null {
  if (k === 0) return order.releasedAt;
  const prev = order.steps[k - 1];
  if (!isClean(prev)) return null;
  const carry = plan.steps[k - 1]?.carry;
  return (prev?.tapAt as number) + (carry ? carry.oneWayM / speed : 0);
}

/** Calibrate from a reconstructed run in the world it was recorded in. */
export function calibrate(
  world: World,
  run: RunReconstruction,
  positions: readonly PositionSample[],
  options: CalibrationOptions = {},
): Calibration {
  const speed = estimateWalkSpeed(positions);
  const plans = planItems(world);
  const warnings: string[] = [];
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
      const arrival = arrivalTime(order, step.step, plan, speed.mps);
      const take = options.orderIds === undefined || options.orderIds.has(order.orderId);
      if (wid !== undefined && arrival !== null && isClean(step) && take) {
        const start = Math.max(arrival, freeAt.get(wid) as number);
        const work = tap - start - sp.fetchM / speed.mps;
        if (work < MIN_WORK_S) clamped += 1;
        (samples[stationId] as number[]).push(Math.max(work, MIN_WORK_S));
        used.add(order.orderId);
      }
      if (wid !== undefined) freeAt.set(wid, tap + sp.carry.roundTripM / speed.mps);
    }
    if (workers.length === 0) warnings.push(`No worker was at "${stationId}" in this layout.`);
    if ((samples[stationId] as number[]).length === 0) warnings.push(`No usable work times at "${stationId}".`);
  }
  if (speed.assumed) warnings.push(`Too little walking in the position log; walking speed assumed ${DEFAULT_WALK_SPEED_MPS} m/s.`);
  const sampleCount = Object.values(samples).reduce((n, s) => n + s.length, 0);
  return {
    walkSpeedMps: speed.mps,
    walkSpeedAssumed: speed.assumed,
    walkSpeedSamples: speed.samples,
    workSamples: samples,
    sampleCount,
    clampedCount: clamped,
    orderIds: run.orders.map((o) => o.orderId).filter((id) => used.has(id)),
    warnings,
  };
}
