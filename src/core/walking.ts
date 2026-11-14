/**
 * Walking per order under the staged-run protocol (see types.ts).
 * Depends on the layout alone: no times, no taps, no randomness.
 */
import { HANDOFF_REACH_M, type Vec2 } from "./types";
import { distance } from "./geometry";
import { shortestPath, type WalkPath } from "./path";
import { itemOf, WorldError, type World } from "./world";
import { itemTasks, workerCovers, type ResolvedTask } from "./tasks";

/** Shortest paths between the stand points the menu and covering workers use, keyed by pair. */
export interface PathTable {
  readonly paths: ReadonlyMap<string, WalkPath>;
}

const pairKey = (a: string, b: string): string => `${a}\u0000${b}`;

function reversed(p: WalkPath): WalkPath {
  return { ...p, points: [...p.points].reverse() };
}

/** Where task k's output goes: the station of the task it feeds, or the pickup. */
function carryTarget(world: World, tasks: readonly ResolvedTask[], t: ResolvedTask): string {
  return t.next === null ? world.pickupId : (tasks[t.next]?.stationId ?? world.pickupId);
}

/** Every (from, to) pair of item ids a fetch or carry walks between for this menu. */
function menuPairs(world: World): readonly (readonly [string, string])[] {
  const pairs: [string, string][] = [];
  for (const m of world.menu) {
    const tasks = itemTasks(m);
    for (const t of tasks) {
      for (const f of t.fetchFrom) pairs.push([t.stationId, f]);
      pairs.push([t.stationId, carryTarget(world, tasks, t)]);
    }
  }
  return pairs;
}

/**
 * For each worker covering several stations: every pair among those stations and the
 * places tasks at them carry to. The engine walks these between tasks.
 */
function coverPairs(world: World): readonly (readonly [string, string])[] {
  const pairs: [string, string][] = [];
  for (const w of world.workers) {
    const covers = workerCovers(w);
    if (covers.length < 2) continue;
    const drops = world.menu.flatMap((m) => {
      const tasks = itemTasks(m);
      return tasks.filter((t) => covers.includes(t.stationId)).map((t) => carryTarget(world, tasks, t));
    });
    const spots = [...new Set([...covers, ...drops])];
    spots.forEach((a, i) => {
      for (const b of spots.slice(i + 1)) pairs.push([a, b]);
    });
  }
  return pairs;
}

/** Compute all paths the menu needs. Call once per layout; the simulator reuses it. */
export function buildPathTable(world: World): PathTable {
  const paths = new Map<string, WalkPath>();
  for (const [a, b] of [...menuPairs(world), ...coverPairs(world)]) {
    if (paths.has(pairKey(a, b))) continue;
    const p = shortestPath(world.obstacles, itemOf(world, a).stand, itemOf(world, b).stand);
    paths.set(pairKey(a, b), p);
    paths.set(pairKey(b, a), reversed(p));
  }
  return { paths };
}

/** Path from item a's stand point to item b's (from the table, or computed). */
export function pathBetween(world: World, table: PathTable | undefined, a: string, b: string): WalkPath {
  const hit = table?.paths.get(pairKey(a, b));
  if (hit) return hit;
  return shortestPath(world.obstacles, itemOf(world, a).stand, itemOf(world, b).stand);
}

export type LegKind = "fetch" | "carry";

export interface WalkLeg {
  readonly kind: LegKind;
  /** Index of the task the leg belongs to (the step index for a chain). */
  readonly step: number;
  readonly fromId: string;
  readonly toId: string;
  /** One-way length along the walkable path. 0 for a hand-off. */
  readonly oneWayM: number;
  /** There and back. 0 for a hand-off. */
  readonly roundTripM: number;
  /** Carry only: stand points within HANDOFF_REACH_M (straight line), passed by hand. */
  readonly handoff: boolean;
  /** No walkable path; a straight line was used. */
  readonly blocked: boolean;
  /** One-way polyline from `fromId` to `toId`. */
  readonly path: readonly Vec2[];
}

export interface ItemWalk {
  readonly itemId: string;
  readonly totalM: number;
  readonly legs: readonly WalkLeg[];
  readonly anyBlocked: boolean;
}

function leg(world: World, table: PathTable | undefined, kind: LegKind, step: number, fromId: string, toId: string): WalkLeg {
  const straight = distance(itemOf(world, fromId).stand, itemOf(world, toId).stand);
  const handoff = kind === "carry" && straight <= HANDOFF_REACH_M;
  const p = pathBetween(world, table, fromId, toId);
  const oneWayM = handoff ? 0 : p.length;
  return { kind, step, fromId, toId, oneWayM, roundTripM: 2 * oneWayM, handoff, blocked: !handoff && p.blocked, path: p.points };
}

/** Exact walking for one order of a menu item: fetch round trips plus carry round trips. */
export function walkingForItem(world: World, itemId: string, table?: PathTable): ItemWalk {
  const item = world.menuById.get(itemId);
  if (!item) throw new WorldError([`Menu item "${itemId}" does not exist.`]);
  const legs: WalkLeg[] = [];
  const tasks = itemTasks(item);
  for (const t of tasks) {
    for (const f of t.fetchFrom) legs.push(leg(world, table, "fetch", t.index, t.stationId, f));
    legs.push(leg(world, table, "carry", t.index, t.stationId, carryTarget(world, tasks, t)));
  }
  const totalM = legs.reduce((sum, l) => sum + l.roundTripM, 0);
  return { itemId, totalM, legs, anyBlocked: legs.some((l) => l.blocked) };
}

export interface WalkingSummary {
  /** Mean over the scheduled orders (or over menu items if the schedule is empty). */
  readonly perOrderM: number;
  readonly byItem: ReadonlyMap<string, ItemWalk>;
  readonly anyBlocked: boolean;
}

/** Walking per order for the whole schedule. */
export function walkingPerOrder(world: World, table?: PathTable): WalkingSummary {
  const t = table ?? buildPathTable(world);
  const byItem = new Map(world.menu.map((m) => [m.id, walkingForItem(world, m.id, t)] as const));
  const orders = world.setup.schedule.orders;
  const ids = orders.length > 0 ? orders.map((o) => o.itemId) : world.menu.map((m) => m.id);
  const total = ids.reduce((sum, id) => sum + (byItem.get(id)?.totalM ?? 0), 0);
  const anyBlocked = [...byItem.values()].some((w) => w.anyBlocked);
  return { perOrderM: ids.length > 0 ? total / ids.length : 0, byItem, anyBlocked };
}
