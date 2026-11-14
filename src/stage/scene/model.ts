/**
 * Pure: turn scan + setup + layout into the list of things the scene draws.
 * No three.js here, so it is unit-tested in node.
 */
import type { BoxSize, ItemRole, Layout, Placement, Scan, Setup } from "../../core/types";

export interface Rect {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export interface SceneItem {
  readonly id: string;
  /** What the scanner called it. */
  readonly category: string;
  /** The owner's name, or the category when the owner has not named it. */
  readonly name: string;
  readonly role: ItemRole;
  readonly locked: boolean;
  readonly size: BoxSize;
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  /** True when the scan box has no setup entry yet. */
  readonly unnamed: boolean;
}

export interface SceneWall {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly length: number;
  readonly thickness: number;
  readonly yaw: number;
}

export interface KitchenData {
  readonly scan: Scan;
  readonly setup?: Setup | null;
  readonly layout?: Layout | null;
}

export function placementOf(id: string, data: KitchenData): Placement {
  const box = data.scan.boxes.find((b) => b.id === id);
  const p = data.layout?.placements[id];
  if (p) return p;
  if (!box) throw new Error(`Unknown box "${id}"`);
  return { x: box.center.x, z: box.center.z, yaw: box.yaw };
}

export function resolveItems(data: KitchenData): readonly SceneItem[] {
  const setupById = new Map((data.setup?.items ?? []).map((i) => [i.boxId, i] as const));
  return data.scan.boxes.map((box) => {
    const s = setupById.get(box.id);
    const p = data.layout?.placements[box.id] ?? { x: box.center.x, z: box.center.z, yaw: box.yaw };
    return {
      id: box.id,
      category: box.category,
      name: s?.name ?? box.category,
      role: s?.role ?? "fixture",
      locked: s?.locked ?? false,
      size: box.size,
      x: p.x,
      z: p.z,
      yaw: p.yaw,
      unnamed: !s,
    };
  });
}

export function resolveWalls(scan: Scan): readonly SceneWall[] {
  return scan.walls.map((w) => ({
    id: w.id,
    x: w.center.x,
    z: w.center.z,
    length: w.size.w,
    thickness: Math.max(0.04, w.size.d),
    yaw: w.yaw,
  }));
}

/** Half extents on the floor of a box of size `size` turned by `yaw`. */
export function footprintHalf(size: BoxSize, yaw: number): { readonly hx: number; readonly hz: number } {
  const c = Math.abs(Math.cos(yaw));
  const s = Math.abs(Math.sin(yaw));
  return { hx: (size.w * c + size.d * s) / 2, hz: (size.w * s + size.d * c) / 2 };
}

export function footprintRect(size: BoxSize, x: number, z: number, yaw: number): Rect {
  const { hx, hz } = footprintHalf(size, yaw);
  return { minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz };
}

export function unionRect(a: Rect | null, b: Rect): Rect {
  if (!a) return b;
  return {
    minX: Math.min(a.minX, b.minX),
    maxX: Math.max(a.maxX, b.maxX),
    minZ: Math.min(a.minZ, b.minZ),
    maxZ: Math.max(a.maxZ, b.maxZ),
  };
}

/** Floor area of the room: the union of the walls and every visible box. */
export function roomBounds(data: KitchenData): Rect {
  let r: Rect | null = null;
  for (const w of resolveWalls(data.scan)) {
    r = unionRect(r, footprintRect({ w: w.length, h: 0, d: w.thickness }, w.x, w.z, w.yaw));
  }
  for (const it of resolveItems(data)) {
    if (it.role === "ignore") continue;
    r = unionRect(r, footprintRect(it.size, it.x, it.z, it.yaw));
  }
  return r ?? { minX: -2, maxX: 2, minZ: -1.5, maxZ: 1.5 };
}

/**
 * The area an item may be dragged in: the room bounds shrunk by the wall
 * thickness on sides that have a wall.
 */
export function dragArea(data: KitchenData): Rect {
  const b = roomBounds(data);
  let { minX, maxX, minZ, maxZ } = b;
  for (const w of resolveWalls(data.scan)) {
    const r = footprintRect({ w: w.length, h: 0, d: w.thickness }, w.x, w.z, w.yaw);
    const horizontal = r.maxX - r.minX >= r.maxZ - r.minZ;
    if (horizontal) {
      if (Math.abs(r.minZ - b.minZ) < 1e-6) minZ = Math.max(minZ, r.maxZ);
      if (Math.abs(r.maxZ - b.maxZ) < 1e-6) maxZ = Math.min(maxZ, r.minZ);
    } else {
      if (Math.abs(r.minX - b.minX) < 1e-6) minX = Math.max(minX, r.maxX);
      if (Math.abs(r.maxX - b.maxX) < 1e-6) maxX = Math.min(maxX, r.minX);
    }
  }
  return { minX, maxX, minZ, maxZ };
}

/** Items that are drawn and block other items. Queue floor marks and ignored noise do not block. */
export function blocks(item: SceneItem): boolean {
  return item.role !== "ignore" && item.role !== "queue";
}

/** New Layout with one placement replaced. Never mutates the input. */
export function withPlacement(layout: Layout, id: string, placement: Placement): Layout {
  return { ...layout, placements: { ...layout.placements, [id]: { ...placement } } };
}

const DEG90 = Math.PI / 2;

/** Snap a yaw to the next quarter turn, in [0, 2pi). */
export function nextQuarterTurn(yaw: number): number {
  const q = Math.round(yaw / DEG90) + 1;
  const turns = ((q % 4) + 4) % 4;
  return turns * DEG90;
}

/** Why a locked item cannot move, in the owner's words. */
export function lockReason(item: Pick<SceneItem, "name" | "category">): string {
  const s = `${item.name} ${item.category}`.toLowerCase();
  if (/sink|wash|dish|tap|water|plumb/.test(s)) return "Fixed: plumbing";
  if (/hood|vent|extract/.test(s)) return "Fixed: ducting";
  return "Fixed: power";
}
