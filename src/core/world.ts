/**
 * World resolution: Scan + Setup + Layout -> the kitchen the model works on.
 */
import {
  BODY_RADIUS_M,
  STAND_OFF_M,
  type BoxSide,
  type BoxSize,
  type ItemRole,
  type Layout,
  type MenuItem,
  type Scan,
  type Setup,
  type Vec2,
  type WorkerDef,
} from "./types";
import { growRect, localToWorld, rectCorners, vec, type OrientedRect } from "./geometry";
import type { Obstacle } from "./path";

export class WorldError extends Error {
  readonly issues: readonly string[];
  constructor(issues: readonly string[]) {
    super(`The kitchen setup has problems:\n- ${issues.join("\n- ")}`);
    this.name = "WorldError";
    this.issues = issues;
  }
}

export interface WorldItem {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly role: Exclude<ItemRole, "ignore">;
  readonly locked: boolean;
  readonly size: BoxSize;
  readonly rect: OrientedRect;
  /** Four floor corners of the box. */
  readonly footprint: readonly Vec2[];
  readonly standSide: BoxSide;
  /** Where a person stands to use it: STAND_OFF_M out from the middle of `standSide`. */
  readonly stand: Vec2;
}

export interface WorldWall {
  readonly id: string;
  readonly rect: OrientedRect;
  readonly footprint: readonly Vec2[];
}

export interface World {
  readonly items: readonly WorldItem[];
  readonly itemsById: ReadonlyMap<string, WorldItem>;
  readonly walls: readonly WorldWall[];
  /** Everything that blocks walking (items with role != ignore, and walls), grown by BODY_RADIUS_M. */
  readonly obstacles: readonly Obstacle[];
  readonly menu: readonly MenuItem[];
  readonly menuById: ReadonlyMap<string, MenuItem>;
  readonly workers: readonly WorkerDef[];
  readonly pickupId: string;
  readonly setup: Setup;
  readonly layout: Layout;
  /** Non-fatal notes, e.g. a scanned box with no setup entry (treated as a fixture). */
  readonly warnings: readonly string[];
}

const SIDE_OFFSET: Readonly<Record<BoxSide, (w: number, d: number) => Vec2>> = {
  front: (_w, d) => vec(0, d + STAND_OFF_M),
  back: (_w, d) => vec(0, -(d + STAND_OFF_M)),
  right: (w) => vec(w + STAND_OFF_M, 0),
  left: (w) => vec(-(w + STAND_OFF_M), 0),
};

/** Stand point of an oriented box: STAND_OFF_M out from the middle of the given side. */
export function standPoint(rect: OrientedRect, side: BoxSide): Vec2 {
  return localToWorld(rect, SIDE_OFFSET[side](rect.halfW, rect.halfD));
}

function checkSetupRefs(scan: Scan, setup: Setup, layout: Layout): string[] {
  const issues: string[] = [];
  const boxIds = new Set(scan.boxes.map((b) => b.id));
  const seen = new Set<string>();
  for (const it of setup.items) {
    if (!boxIds.has(it.boxId)) issues.push(`Setup names box "${it.boxId}", which is not in the scan.`);
    if (seen.has(it.boxId)) issues.push(`Box "${it.boxId}" is set up twice.`);
    seen.add(it.boxId);
  }
  for (const id of Object.keys(layout.placements)) {
    if (!boxIds.has(id)) issues.push(`Layout places box "${id}", which is not in the scan.`);
  }
  return issues;
}

function checkProcess(setup: Setup, layout: Layout, roles: ReadonlyMap<string, ItemRole>): string[] {
  const issues: string[] = [];
  const roleIs = (id: string, role: ItemRole): boolean => roles.get(id) === role;
  if (!roleIs(setup.pickupId, "pickup")) issues.push(`Pickup "${setup.pickupId}" is not a box with role "pickup".`);
  if (setup.menu.length === 0) issues.push("The menu has no items.");
  for (const m of setup.menu) {
    if (m.steps.length === 0) issues.push(`Menu item "${m.name}" has no steps.`);
    m.steps.forEach((s, i) => {
      if (s.workSeconds !== undefined && (!Number.isFinite(s.workSeconds) || s.workSeconds < 0)) issues.push(`Menu item "${m.name}" step ${i + 1} has an invalid preparation time.`);
      if (!roleIs(s.stationId, "station")) issues.push(`"${m.name}" step ${i + 1} is at "${s.stationId}", which is not a station.`);
      for (const f of s.fetchFrom ?? []) {
        if (!roleIs(f, "storage")) issues.push(`"${m.name}" step ${i + 1} fetches from "${f}", which is not storage.`);
      }
    });
  }
  const menuIds = new Set(setup.menu.map((m) => m.id));
  const orderIds = new Set<string>();
  for (const o of setup.schedule.orders) {
    if (!menuIds.has(o.itemId)) issues.push(`Order "${o.orderId}" is for "${o.itemId}", which is not on the menu.`);
    if (orderIds.has(o.orderId)) issues.push(`Order id "${o.orderId}" appears twice in the schedule.`);
    orderIds.add(o.orderId);
  }
  const workerIds = new Set<string>();
  for (const w of layout.workers) {
    if (!roleIs(w.stationId, "station")) issues.push(`Worker "${w.name}" stands at "${w.stationId}", which is not a station.`);
    if (workerIds.has(w.id)) issues.push(`Worker id "${w.id}" appears twice.`);
    workerIds.add(w.id);
  }
  return issues;
}

function placeRect(center: Vec2, size: BoxSize, yaw: number): OrientedRect {
  return { center, halfW: size.w / 2, halfD: size.d / 2, yaw };
}

/**
 * Resolve a kitchen. Throws WorldError listing every problem found.
 * Scanned boxes with no setup entry are treated as fixtures (they block walking) and noted in `warnings`.
 */
export function resolveWorld(scan: Scan, setup: Setup, layout: Layout): World {
  const refIssues = checkSetupRefs(scan, setup, layout);
  const setupById = new Map(setup.items.map((it) => [it.boxId, it] as const));
  const roles = new Map(scan.boxes.map((b) => [b.id, setupById.get(b.id)?.role ?? ("fixture" as ItemRole)] as const));
  const issues = [...refIssues, ...checkProcess(setup, layout, roles)];
  if (issues.length > 0) throw new WorldError(issues);

  const warnings: string[] = [];
  const items: WorldItem[] = [];
  for (const box of scan.boxes) {
    const it = setupById.get(box.id);
    if (!it) warnings.push(`Scanned box "${box.id}" (${box.category}) has no setup; treated as a fixture.`);
    const role = it?.role ?? "fixture";
    if (role === "ignore") continue;
    const placed = layout.placements[box.id];
    const rect = placed
      ? placeRect(vec(placed.x, placed.z), box.size, placed.yaw)
      : placeRect(vec(box.center.x, box.center.z), box.size, box.yaw);
    const standSide = it?.standSide ?? "front";
    items.push({
      id: box.id,
      name: it?.name ?? box.category,
      category: box.category,
      role,
      locked: it?.locked ?? false,
      size: box.size,
      rect,
      footprint: rectCorners(rect),
      standSide,
      stand: standPoint(rect, standSide),
    });
  }
  const walls: WorldWall[] = scan.walls.map((w) => {
    const rect = placeRect(vec(w.center.x, w.center.z), w.size, w.yaw);
    return { id: w.id, rect, footprint: rectCorners(rect) };
  });
  const obstacles: Obstacle[] = [
    ...items.map((i) => ({ id: i.id, raw: i.rect, grown: growRect(i.rect, BODY_RADIUS_M) })),
    ...walls.map((w) => ({ id: w.id, raw: w.rect, grown: growRect(w.rect, BODY_RADIUS_M) })),
  ];
  return {
    items,
    itemsById: new Map(items.map((i) => [i.id, i] as const)),
    walls,
    obstacles,
    menu: setup.menu,
    menuById: new Map(setup.menu.map((m) => [m.id, m] as const)),
    workers: layout.workers,
    pickupId: setup.pickupId,
    setup,
    layout,
    warnings,
  };
}

/** The item with this id, or a clear error. */
export function itemOf(world: World, id: string): WorldItem {
  const it = world.itemsById.get(id);
  if (!it) throw new WorldError([`No item "${id}" in the kitchen.`]);
  return it;
}
