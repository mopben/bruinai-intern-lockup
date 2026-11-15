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
 * - A station with a capacity holds that many people at once, each from the take
 *   (walk included) to the tap. A ready task waits for a place.
 * - The workers are replayed together in time order, earliest ask first, layout
 *   order on ties, as the engine's resting workers ask in layout order.
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

/**
 * One worker's replay state. Mutable, local to one replay: the next tap to place,
 * where and from when it rests, and when it next asks for that task.
 */
interface Lane {
  readonly worker: WorkerDef;
  readonly roams: boolean;
  readonly taps: readonly Tapped[];
  next: number;
  rest: Rest;
  checkAt: number;
}

/** A place at a station, held from the take (walk included) to the tap, as in the engine. */
interface Held {
  readonly start: number;
  readonly tap: number;
}

interface Places {
  /** People a station holds at once; Infinity when unlimited. */
  readonly capacity: ReadonlyMap<string, number>;
  /** Places taken so far, per station. Local and growing during one replay. */
  readonly held: ReadonlyMap<string, Held[]>;
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

function restAfter(ctx: Context, lane: Lane, task: ResolvedTask, sp: StepPlan, tap: number): Rest {
  const c = walkSeconds(ctx.pace, sp.carry.oneWayM);
  if (!lane.roams) return { atId: lane.worker.stationId, at: tap + 2 * c };
  return { atId: c > 0 ? sp.carry.toId : task.stationId, at: tap + c };
}

/** Places taken at `stationId` that are still held at time t (held from start to tap). */
function heldAt(places: Places, stationId: string, t: number): readonly Held[] {
  return (places.held.get(stationId) ?? []).filter((h) => h.start <= t && h.tap > t);
}

/** True when the station has room for one more person at time t. */
function roomAt(places: Places, stationId: string, t: number): boolean {
  const cap = places.capacity.get(stationId) ?? Infinity;
  return !Number.isFinite(cap) || heldAt(places, stationId, t).length < cap;
}

/** The next time after t that a place at the station frees. */
function nextFree(places: Places, stationId: string, t: number): number {
  return Math.min(...heldAt(places, stationId, t).map((h) => h.tap));
}

/** The lane takes its next task at `now`: hold a place, measure the work, rest after the tap. */
function commit(ctx: Context, lane: Lane, places: Places, row: Tapped, now: number, out: ReplayedWork[]): void {
  const { order, step, tap } = row;
  const task = ctx.tasks.get(order.itemId)?.[step.step] as ResolvedTask;
  const sp = ctx.plans.get(order.itemId)?.steps[step.step] as StepPlan;
  places.held.get(task.stationId)?.push({ start: now, tap });
  const take = ctx.options.orderIds === undefined || ctx.options.orderIds.has(order.orderId);
  if (readyTime(ctx, order, task) !== null && isClean(step) && take) {
    const work = tap - now - walkBetween(ctx, lane.rest.atId, task.stationId) - fetchSeconds(ctx.pace, sp);
    out.push({ orderId: order.orderId, itemId: order.itemId, taskId: task.id, stationId: task.stationId, tap, work });
  }
  lane.rest = restAfter(ctx, lane, task, sp, tap);
  lane.next += 1;
  lane.checkAt = lane.rest.at;
}

/**
 * The lane asks for its next task at its check time. It takes it when the task is ready
 * and its station has room. Otherwise a roaming worker away from home walks home, and
 * any other waits until the task is ready or a place frees.
 */
function check(ctx: Context, lane: Lane, places: Places, out: ReplayedWork[]): void {
  const now = lane.checkAt;
  const row = lane.taps[lane.next] as Tapped;
  const task = ctx.tasks.get(row.order.itemId)?.[row.step.step];
  if (!task || !ctx.plans.get(row.order.itemId)?.steps[row.step.step]) {
    lane.next += 1;
    return;
  }
  // Unknown inputs: no sample is taken, and the task is not ready before its release.
  const ready = readyTime(ctx, row.order, task) ?? row.order.releasedAt;
  const room = roomAt(places, task.stationId, now);
  if (ready <= now && room) return commit(ctx, lane, places, row, now, out);
  const home = lane.worker.stationId;
  if (lane.roams && lane.rest.atId !== home) {
    lane.rest = { atId: home, at: now + walkBetween(ctx, lane.rest.atId, home) };
    lane.checkAt = lane.rest.at;
    return;
  }
  lane.checkAt = ready > now ? ready : nextFree(places, task.stationId, now);
}

/** The lane with the earliest check time (layout order on ties), or null when all are done. */
function earliest(lanes: readonly Lane[]): Lane | null {
  let best: Lane | null = null;
  for (const lane of lanes) {
    if (lane.next >= lane.taps.length || lane.checkAt === Infinity) continue;
    if (best === null || lane.checkAt < best.checkAt) best = lane;
  }
  return best;
}

function newLanes(world: World, run: RunReconstruction): { readonly lanes: readonly Lane[]; readonly unnamed: number; readonly unknown: number } {
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
  const lanes = world.workers.map((worker): Lane => ({
    worker,
    roams: workerCovers(worker).length > 1,
    taps: [...(byWorker.get(worker.id) ?? [])].sort((a, b) => a.tap - b.tap),
    next: 0,
    rest: { atId: worker.stationId, at: -Infinity },
    checkAt: -Infinity,
  }));
  return { lanes, unnamed, unknown };
}

function newPlaces(world: World): Places {
  const stations = [...new Set(world.menu.flatMap((m) => m.steps.map((s) => s.stationId)))];
  const capacity = new Map(stations.map((id) => [id, world.setup.items.find((it) => it.boxId === id)?.capacity ?? Infinity] as const));
  return { capacity, held: new Map(stations.map((id) => [id, [] as Held[]])) };
}

/** Work times for every tap that names a worker of the layout, replayed in one time-ordered pass. */
export function replayTaskWork(world: World, run: RunReconstruction, pace: Pace, options: CalibrationOptions = {}): ReplayResult {
  const table = buildPathTable(world);
  const ctx: Context = { world, table, pace, plans: planItems(world, table), tasks: new Map(world.menu.map((m) => [m.id, itemTasks(m)] as const)), options };
  const { lanes, unnamed, unknown } = newLanes(world, run);
  const places = newPlaces(world);
  const out: ReplayedWork[] = [];
  for (let lane = earliest(lanes); lane !== null; lane = earliest(lanes)) check(ctx, lane, places, out);
  const work = [...out].sort((a, b) => a.tap - b.tap);
  const warnings = [...(unnamed > 0 ? [NO_WORKER_WARNING] : []), ...(unknown > 0 ? [UNKNOWN_WORKER_WARNING] : [])];
  return { work, warnings };
}
