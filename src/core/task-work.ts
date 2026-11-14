/**
 * Work times for kitchens that are not chains with fixed workers (task graphs,
 * workers who cover several stations). Replays the engine's rules (engine/run.ts)
 * over each worker's taps in time order:
 *
 * - A task is ready when every input has arrived: on release if it waits for nothing,
 *   else the latest of (input's tap + that input's one-way carry).
 * - A worker who covers one station rests at home one carry back (tap + 2 × carry).
 *   A worker who covers several rests at the drop point (tap + carry), or at the
 *   station for a hand-off. Resting away from home with nothing ready, it walks home
 *   and rests again on arrival.
 * - work = tap − max(ready, worker free) − walk to the station − fetch walking.
 *
 * Needs `workerId` on the taps; taps without one are skipped. Nothing passed in is changed.
 */
import type { WorkerDef } from "./types";
import type { World } from "./world";
import type { CalibrationOptions } from "./calibrate";
import type { RunReconstruction } from "./reconstruct";
import type { OrderTrace, StepTrace } from "./trace";
import { planItems, type ItemPlan, type StepPlan } from "./plan";
import { walkSeconds, type Pace } from "./pace";
import { buildPathTable, pathBetween, type PathTable } from "./walking";
import { itemTasks, workerCovers, type ResolvedTask } from "./tasks";

export const NO_WORKER_WARNING = "Some taps do not say who did the step, so their work times could not be learned.";
export const UNKNOWN_WORKER_WARNING = "Some taps name a worker who is not in this layout, so their work times could not be learned.";

/** One measured work time, walking removed and not yet clamped. */
export interface ReplayedWork {
  readonly orderId: string;
  readonly itemId: string;
  readonly taskId: string;
  readonly stationId: string;
  readonly tap: number;
  readonly work: number;
}

export interface ReplayResult {
  /** In tap order. */
  readonly work: readonly ReplayedWork[];
  readonly warnings: readonly string[];
}

interface Tapped {
  readonly order: OrderTrace;
  readonly step: StepTrace;
  readonly tap: number;
}

/** Where a worker is and from when it can take a task. */
interface Rest {
  readonly atId: string;
  readonly at: number;
}

interface Context {
  readonly world: World;
  readonly table: PathTable;
  readonly pace: Pace;
  readonly plans: ReadonlyMap<string, ItemPlan>;
  readonly tasks: ReadonlyMap<string, readonly ResolvedTask[]>;
  readonly options: CalibrationOptions;
}

const isClean = (s: StepTrace | undefined): boolean => s !== undefined && s.tapAt !== null && s.tapAt === s.doneAt;

const fetchSeconds = (pace: Pace, sp: StepPlan): number => sp.fetchLegs.reduce((s, l) => s + 2 * walkSeconds(pace, l.oneWayM), 0);

function walkBetween(ctx: Context, from: string, to: string): number {
  return from === to ? 0 : walkSeconds(ctx.pace, pathBetween(ctx.world, ctx.table, from, to).length);
}

/** When every input of the task had arrived at its station, or null if an input's tap is unknown. */
function readyTime(ctx: Context, order: OrderTrace, task: ResolvedTask): number | null {
  if (task.after.length === 0) return order.releasedAt;
  const plan = ctx.plans.get(order.itemId);
  const times = task.after.map((j) => {
    const prev = order.steps[j];
    const carry = plan?.steps[j]?.carry;
    return isClean(prev) && carry ? (prev?.tapAt as number) + walkSeconds(ctx.pace, carry.oneWayM) : null;
  });
  return times.some((t) => t === null) ? null : Math.max(...(times as number[]));
}

/** Where and when the worker began the task that became ready at `ready`. */
function startOf(ctx: Context, w: WorkerDef, rest: Rest, ready: number): Rest {
  if (ready <= rest.at || rest.atId === w.stationId) return { atId: rest.atId, at: Math.max(ready, rest.at) };
  const home = rest.at + walkBetween(ctx, rest.atId, w.stationId);
  return { atId: w.stationId, at: Math.max(ready, home) };
}

function restAfter(ctx: Context, w: WorkerDef, roams: boolean, task: ResolvedTask, sp: StepPlan, tap: number): Rest {
  const c = walkSeconds(ctx.pace, sp.carry.oneWayM);
  if (!roams) return { atId: w.stationId, at: tap + 2 * c };
  return { atId: c > 0 ? sp.carry.toId : task.stationId, at: tap + c };
}

/** One worker's taps, in time order: the work time of each usable one. */
function replayWorker(ctx: Context, w: WorkerDef, taps: readonly Tapped[]): readonly ReplayedWork[] {
  const roams = workerCovers(w).length > 1;
  const out: ReplayedWork[] = [];
  let rest: Rest = { atId: w.stationId, at: -Infinity };
  for (const { order, step, tap } of taps) {
    const task = ctx.tasks.get(order.itemId)?.[step.step];
    const sp = ctx.plans.get(order.itemId)?.steps[step.step];
    if (!task || !sp) continue;
    const ready = readyTime(ctx, order, task);
    const take = ctx.options.orderIds === undefined || ctx.options.orderIds.has(order.orderId);
    if (ready !== null && isClean(step) && take) {
      const start = startOf(ctx, w, rest, ready);
      const work = tap - start.at - walkBetween(ctx, start.atId, task.stationId) - fetchSeconds(ctx.pace, sp);
      out.push({ orderId: order.orderId, itemId: order.itemId, taskId: task.id, stationId: task.stationId, tap, work });
    }
    rest = restAfter(ctx, w, roams, task, sp, tap);
  }
  return out;
}

/** Work times for every tap that names a worker of the layout, replayed per worker. */
export function replayTaskWork(world: World, run: RunReconstruction, pace: Pace, options: CalibrationOptions = {}): ReplayResult {
  const table = buildPathTable(world);
  const ctx: Context = { world, table, pace, plans: planItems(world, table), tasks: new Map(world.menu.map((m) => [m.id, itemTasks(m)] as const)), options };
  const tapped: Tapped[] = run.orders.flatMap((order) => order.steps.filter((s) => s.tapAt !== null).map((step) => ({ order, step, tap: step.tapAt as number })));
  const byWorker = new Map<string, Tapped[]>(world.workers.map((w) => [w.id, []]));
  let unnamed = 0;
  let unknown = 0;
  for (const t of tapped) {
    const id = t.step.workerId;
    if (id === null) unnamed += 1;
    else if (!byWorker.has(id)) unknown += 1;
    else byWorker.get(id)?.push(t);
  }
  const work = world.workers
    .flatMap((w) => replayWorker(ctx, w, [...(byWorker.get(w.id) ?? [])].sort((a, b) => a.tap - b.tap)))
    .sort((a, b) => a.tap - b.tap);
  const warnings = [...(unnamed > 0 ? [NO_WORKER_WARNING] : []), ...(unknown > 0 ? [UNKNOWN_WORKER_WARNING] : [])];
  return { work, warnings };
}
