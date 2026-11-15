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
import { isChainKitchen, itemTasks, workerCovers } from "./tasks";
import { replayTaskWork } from "./task-work";

export { DEFAULT_WALK_SPEED_MPS, estimateWalkSpeed, MOVING_THRESHOLD_MPS, SPEED_WINDOW_S, type SpeedEstimate } from "./speed";

/** Work-time samples are clamped up to this (a step cannot take no time). */
export const MIN_WORK_S = 0.5;

/** A task with fewer samples than this uses all samples of its station. */
export const MIN_TASK_SAMPLES = 3;

/** Key of `Calibration.taskSamples` for one task of one menu item. */
export function taskKey(itemId: string, taskId: string): string {
  return `${itemId}\u0000${taskId}`;
}

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
  /** The same samples keyed by menu item and task (`taskKey`), in the same order. */
  readonly taskSamples: Readonly<Record<string, readonly number[]>>;
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

/** Work samples and what came with them; local accumulators of one calibration. */
interface WorkResult {
  readonly samples: Record<string, number[]>;
  readonly byTask: Record<string, number[]>;
  readonly clamped: number;
  readonly used: ReadonlySet<string>;
  readonly warnings: readonly string[];
}

/** Chain kitchens with fixed workers: per station, workers free one carry back after each tap. */
function chainWork(world: World, run: RunReconstruction, pace: Pace, options: CalibrationOptions): WorkResult {
  const plans = planItems(world);
  const warnings: string[] = [];
  const samples: Record<string, number[]> = {};
  const byTask: Record<string, number[]> = {};
  const taskIds = new Map(world.menu.map((m) => [m.id, itemTasks(m).map((t) => t.id)] as const));
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
        const value = Math.max(work, MIN_WORK_S);
        (samples[stationId] as number[]).push(value);
        const key = taskKey(order.itemId, taskIds.get(order.itemId)?.[step.step] ?? `s${step.step}`);
        (byTask[key] ??= []).push(value);
        used.add(order.orderId);
      }
      if (wid !== undefined) freeAt.set(wid, tap + 2 * walkSeconds(pace, sp.carry.oneWayM));
    }
    if (workers.length === 0) warnings.push(`No worker was at "${stationId}" in this layout.`);
    if ((samples[stationId] as number[]).length === 0) warnings.push(`No usable work times at "${stationId}".`);
  }
  return { samples, byTask, clamped, used, warnings };
}

/** Other kitchens: the engine's rules replayed over each worker's taps (task-work.ts). */
function taskWork(world: World, run: RunReconstruction, pace: Pace, options: CalibrationOptions): WorkResult {
  const replay = replayTaskWork(world, run, pace, options);
  const stations = [...new Set(world.menu.flatMap((m) => m.steps.map((s) => s.stationId)))];
  const samples: Record<string, number[]> = Object.fromEntries(stations.map((id) => [id, []]));
  const byTask: Record<string, number[]> = {};
  const used = new Set<string>();
  let clamped = 0;
  for (const r of replay.work) {
    if (r.work < MIN_WORK_S) clamped += 1;
    const value = Math.max(r.work, MIN_WORK_S);
    (samples[r.stationId] ??= []).push(value);
    (byTask[taskKey(r.itemId, r.taskId)] ??= []).push(value);
    used.add(r.orderId);
  }
  const stationWarnings = stations.flatMap((id) => [
    ...(world.workers.some((w) => workerCovers(w).includes(id)) ? [] : [`No worker was at "${id}" in this layout.`]),
    ...((samples[id] ?? []).length === 0 ? [`No usable work times at "${id}".`] : []),
  ]);
  return { samples, byTask, clamped, used, warnings: [...replay.warnings, ...stationWarnings] };
}

/** Calibrate from a reconstructed run in the world it was recorded in. */
export function calibrate(
  world: World,
  run: RunReconstruction,
  positions: readonly PositionSample[],
  options: CalibrationOptions = {},
): Calibration {
  const est = estimatePace(world, positions);
  const pace = est.pace;
  const learn = isChainKitchen(world.menu, world.workers) ? chainWork : taskWork;
  const { samples, byTask, clamped, used, warnings: workWarnings } = learn(world, run, pace, options);
  const warnings = [...est.warnings, ...workWarnings];
  const sampleCount = Object.values(samples).reduce((n, s) => n + s.length, 0);
  return {
    walkSpeedMps: pace.speedMps,
    walkOverheadS: pace.overheadS,
    paceMethod: est.method,
    paceTrips: est.trips,
    walkSpeedAssumed: est.method === "assumed",
    walkSpeedSamples: est.samples,
    workSamples: samples,
    taskSamples: byTask,
    sampleCount,
    clampedCount: clamped,
    orderIds: run.orders.map((o) => o.orderId).filter((id) => used.has(id)),
    warnings,
  };
}
