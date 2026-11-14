/**
 * Walking per order under the staged-run protocol (see types.ts).
 * Depends on the layout alone: no times, no taps, no randomness.
 */
import { HANDOFF_REACH_M, type Vec2 } from "./types";
import { distance } from "./geometry";
import { shortestPath, type WalkPath } from "./path";
import { itemOf, WorldError, type World } from "./world";

/** Shortest paths between the stand points the menu uses, keyed by pair. */
export interface PathTable {
  readonly paths: ReadonlyMap<string, WalkPath>;
}

const pairKey = (a: string, b: string): string => `${a}\u0000${b}`;

function reversed(p: WalkPath): WalkPath {
  return { ...p, points: [...p.points].reverse() };
}

/** Every (from, to) pair of item ids a worker may walk between for this menu. */
function menuPairs(world: World): readonly (readonly [string, string])[] {
  const pairs: [string, string][] = [];
  for (const m of world.menu) {
    m.steps.forEach((s, k) => {
      for (const f of s.fetchFrom ?? []) pairs.push([s.stationId, f]);
      const next = m.steps[k + 1]?.stationId ?? world.pickupId;
      pairs.push([s.stationId, next]);
    });
  }
  return pairs;
}

/** Compute all paths the menu needs. Call once per layout; the simulator reuses it. */
export function buildPathTable(world: World): PathTable {
  const paths = new Map<string, WalkPath>();
  for (const [a, b] of menuPairs(world)) {
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
  /** Step index the leg belongs to. */
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
  item.steps.forEach((s, k) => {
    for (const f of s.fetchFrom ?? []) legs.push(leg(world, table, "fetch", k, s.stationId, f));
    const next = item.steps[k + 1]?.stationId ?? world.pickupId;
    legs.push(leg(world, table, "carry", k, s.stationId, next));
  });
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
