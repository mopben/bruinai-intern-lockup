/**
 * The task-centred engine's compiled model: a world plus a calibration, checked and
 * turned into flat data the event loop can use quickly. Build once per layout.
 */
import type { MenuItem, Vec2 } from "../types";
import type { World } from "../world";
import { taskKey, MIN_TASK_SAMPLES, type Calibration } from "../calibrate";
import { buildPathTable, pathBetween, type PathTable } from "../walking";
import { planItems, type StepPlan } from "../plan";
import { menuStations } from "../timeline";
import { itemTasks, workerCovers, type ResolvedTask } from "../tasks";
import type { Pace, PaceMethod } from "../pace";
import type { Trip } from "../trips";

/** A layout or calibration the engine cannot run, in words safe to show. */
export class SimError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SimError";
  }
}

/** FNV-1a hash of a string: a stable integer key for random streams. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface EngineLeg {
  /** One-way walking length; 0 for a hand-off. */
  readonly oneWayM: number;
  readonly path: readonly Vec2[];
  /** No walkable path; a straight line is used. */
  readonly blocked: boolean;
}

export interface EngineTask extends ResolvedTask {
  readonly stationIndex: number;
  /** Storage round trips before the work, in order. */
  readonly fetch: readonly EngineLeg[];
  /** One-way carry to `carryTo`; length 0 for a hand-off. */
  readonly carry: EngineLeg;
  /** The next task's station, or the pickup. */
  readonly carryTo: string;
  /** Index into `EngineModel.pools`. */
  readonly pool: number;
}

export interface EngineWorker {
  readonly id: string;
  readonly homeId: string;
  /** Station indices this worker may work at (menu stations only). */
  readonly covers: readonly number[];
  /** Covers several stations: rests where it drops its carry and walks between stations. */
  readonly roams: boolean;
}

export interface WorkPool {
  readonly samples: readonly number[];
  /** Stable stream key for resampling this pool. */
  readonly key: number;
}

export interface EngineModel {
  readonly world: World;
  readonly table: PathTable;
  /** Stations in the order the menu first uses them. */
  readonly stationIds: readonly string[];
  /** People who may work at each station at once; Infinity when unlimited. */
  readonly capacity: readonly number[];
  /** In layout order. */
  readonly workers: readonly EngineWorker[];
  readonly items: ReadonlyMap<string, readonly EngineTask[]>;
  /** Most tasks in any menu item; the job number is order × maxTasks + task. */
  readonly maxTasks: number;
  readonly pace: Pace;
  readonly paceMethod: PaceMethod;
  readonly paceTrips: readonly Trip[];
  readonly pools: readonly WorkPool[];
  /** Walks a roaming worker may make between stations and drop points, keyed by `walkKey`. */
  readonly walks: ReadonlyMap<string, EngineLeg>;
  /** Some walk the engine may use (menu or roaming) has no walkable path. */
  readonly anyBlocked: boolean;
}

export const walkKey = (a: string, b: string): string => `${a}\u0000${b}`;

const nameOf = (world: World, id: string): string => world.itemsById.get(id)?.name ?? id;

function checkPace(calibration: Calibration): Pace {
  const pace: Pace = { speedMps: calibration.walkSpeedMps, overheadS: calibration.walkOverheadS };
  if (!(pace.speedMps > 0)) throw new SimError(`Walking speed must be positive (got ${pace.speedMps}).`);
  if (!(pace.overheadS >= 0)) throw new SimError(`Walking overhead must not be negative (got ${pace.overheadS}).`);
  return pace;
}

function compileWorkers(world: World, stationIds: readonly string[]): readonly EngineWorker[] {
  const workers = world.workers.map((w) => {
    const covers = workerCovers(w);
    return { id: w.id, homeId: w.stationId, covers: covers.map((id) => stationIds.indexOf(id)).filter((i) => i >= 0), roams: covers.length > 1 };
  });
  stationIds.forEach((id, s) => {
    if (!workers.some((w) => w.covers.includes(s))) throw new SimError(`Nobody works at "${nameOf(world, id)}". Put at least one worker there.`);
  });
  return workers;
}

/** The work time the owner typed for this task's step (`steps[k]` goes with task k), or undefined. */
export function typedWorkSeconds(item: MenuItem, taskIndex: number): number | undefined {
  return item.steps[taskIndex]?.workSeconds;
}

/**
 * One pool per (item, task). Keyed by station alone when the station does one task in the whole menu.
 * A task whose step has a typed time gets a pool of that one value: it is used as it is, never resampled
 * into anything else, and the station needs no measured samples for it.
 */
function compilePools(world: World, calibration: Calibration): { readonly pools: readonly WorkPool[]; readonly index: ReadonlyMap<string, number> } {
  const all = world.menu.flatMap((m) => itemTasks(m).map((t) => ({ itemId: m.id, task: t, typed: typedWorkSeconds(m, t.index) })));
  const perStation = new Map<string, number>();
  for (const { task } of all) perStation.set(task.stationId, (perStation.get(task.stationId) ?? 0) + 1);
  const pools: WorkPool[] = [];
  const index = new Map<string, number>();
  for (const { itemId, task, typed } of all) {
    if (typed !== undefined) {
      index.set(taskKey(itemId, task.id), pools.length);
      pools.push({ samples: [typed], key: hashString(`${task.stationId}|${itemId}|${task.id}|typed`) });
      continue;
    }
    const own = (calibration.taskSamples ?? {})[taskKey(itemId, task.id)] ?? [];
    const samples = own.length >= MIN_TASK_SAMPLES ? own : (calibration.workSamples[task.stationId] ?? []);
    if (samples.length === 0) throw new SimError(`No measured work times for "${nameOf(world, task.stationId)}"; record a run where it is used.`);
    const alone = perStation.get(task.stationId) === 1;
    index.set(taskKey(itemId, task.id), pools.length);
    pools.push({ samples, key: hashString(alone ? task.stationId : `${task.stationId}|${itemId}|${task.id}`) });
  }
  return { pools, index };
}

function compileItems(world: World, table: PathTable, stationIds: readonly string[], poolIndex: ReadonlyMap<string, number>): ReadonlyMap<string, readonly EngineTask[]> {
  const plans = planItems(world, table);
  const items = new Map<string, readonly EngineTask[]>();
  for (const m of world.menu) {
    const steps = plans.get(m.id)?.steps ?? [];
    const tasks = itemTasks(m).map((t): EngineTask => {
      const sp = steps[t.index] as StepPlan;
      return {
        ...t,
        stationIndex: stationIds.indexOf(t.stationId),
        fetch: sp.fetchLegs.map((l) => ({ oneWayM: l.oneWayM, path: l.path, blocked: l.blocked })),
        carry: { oneWayM: sp.carry.oneWayM, path: sp.carry.path, blocked: sp.carry.blocked },
        carryTo: sp.carry.toId,
        pool: poolIndex.get(taskKey(m.id, t.id)) as number,
      };
    });
    items.set(m.id, tasks);
  }
  return items;
}

/** Every walk between the places a roaming worker can be: its stations, its drop points and home. */
function compileWalks(world: World, table: PathTable, workers: readonly EngineWorker[], stationIds: readonly string[], items: ReadonlyMap<string, readonly EngineTask[]>): ReadonlyMap<string, EngineLeg> {
  const walks = new Map<string, EngineLeg>();
  for (const w of workers.filter((x) => x.roams)) {
    const stations = w.covers.map((s) => stationIds[s] as string);
    const drops = [...items.values()].flat().filter((t) => stations.includes(t.stationId) && t.carry.oneWayM > 0).map((t) => t.carryTo);
    const spots = [...new Set([w.homeId, ...stations, ...drops])];
    for (const a of spots) {
      for (const b of spots) {
        if (a === b || walks.has(walkKey(a, b))) continue;
        const p = pathBetween(world, table, a, b);
        walks.set(walkKey(a, b), { oneWayM: p.length, path: p.points, blocked: p.blocked });
      }
    }
  }
  return walks;
}

function menuBlocked(items: ReadonlyMap<string, readonly EngineTask[]>): boolean {
  return [...items.values()].flat().some((t) => t.carry.blocked || t.fetch.some((l) => l.blocked));
}

/** Check and compile. Throws SimError for a station nobody covers, a task with no work samples, or a bad pace. */
export function compileEngineModel(world: World, calibration: Calibration, table?: PathTable): EngineModel {
  const t = table ?? buildPathTable(world);
  const pace = checkPace(calibration);
  const stationIds = menuStations(world.menu);
  const workers = compileWorkers(world, stationIds);
  const { pools, index } = compilePools(world, calibration);
  const items = compileItems(world, t, stationIds, index);
  const walks = compileWalks(world, t, workers, stationIds, items);
  const capacity = stationIds.map((id) => world.setup.items.find((it) => it.boxId === id)?.capacity ?? Infinity);
  const maxTasks = Math.max(0, ...[...items.values()].map((s) => s.length));
  const anyBlocked = menuBlocked(items) || [...walks.values()].some((l) => l.blocked);
  return { world, table: t, stationIds, capacity, workers, items, maxTasks, pace, paceMethod: calibration.paceMethod, paceTrips: calibration.paceTrips, pools, walks, anyBlocked };
}
