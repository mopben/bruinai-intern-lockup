/**
 * What the camera page needs from the kitchen: box footprints (for the
 * mini-map and the overlay), reference points to calibrate against, room
 * bounds, and a key to store calibrations under.
 */
import type { Layout, Scan, Setup, Vec2, Vec3, WorkerDef } from "../core/types";
import { resolveWorld } from "../core/world";
import { fail, ok, type Result } from "./result";

export interface Kitchen {
  readonly scan: Scan;
  readonly setup: Setup;
  readonly layout: Layout;
}

export interface KitchenBox {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly height: number;
  readonly footprint: readonly Vec2[];
}

export interface RefPoint {
  readonly id: string;
  readonly label: string;
  readonly world: Vec3;
  readonly kind: "floor" | "top";
}

export interface Bounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export interface KitchenView {
  readonly key: string;
  readonly boxes: readonly KitchenBox[];
  readonly walls: readonly (readonly Vec2[])[];
  readonly refs: readonly RefPoint[];
  readonly bounds: Bounds;
  readonly workers: readonly WorkerDef[];
  /** Where each worker stands at their own station (for measuring hat heights). */
  readonly stands: Readonly<Record<string, Vec2>>;
}

const CORNER_NAMES = ["back left", "back right", "front right", "front left"] as const;
/** Boxes lower than this (floor marks) give no top points. */
const MIN_TOP_HEIGHT_M = 0.3;

/** Short stable hash (djb2) for storage keys. */
export function hashText(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Calibrations depend on the scan's floor frame only, not on where boxes were dragged. */
export const kitchenKey = (scan: Scan): string =>
  hashText([scan.capturedAt, ...scan.boxes.map((b) => b.id), ...scan.walls.map((w) => w.id)].join("|"));

function roomCorners(walls: readonly (readonly Vec2[])[]): RefPoint[] {
  const ends: Vec2[] = [];
  for (const fp of walls) {
    // Middle of each short side of the wall rectangle = the wall's ends.
    const [a, b, c, d] = fp as [Vec2, Vec2, Vec2, Vec2];
    const long = Math.hypot(b.x - a.x, b.z - a.z) >= Math.hypot(d.x - a.x, d.z - a.z);
    const pairs = long ? [[a, d], [b, c]] : [[a, b], [d, c]];
    for (const [p, q] of pairs as [Vec2, Vec2][]) ends.push({ x: (p.x + q.x) / 2, z: (p.z + q.z) / 2 });
  }
  const unique = ends.filter((p, i) => ends.findIndex((q) => Math.hypot(p.x - q.x, p.z - q.z) < 0.25) === i);
  return unique.map((p, i) => ({ id: `wall-end-${i}`, label: `Wall end ${i + 1} (floor)`, world: { x: p.x, y: 0, z: p.z }, kind: "floor" }));
}

export function kitchenView(k: Kitchen): Result<KitchenView> {
  let world;
  try {
    world = resolveWorld(k.scan, k.setup, k.layout);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "The kitchen could not be read.");
  }
  const boxes: KitchenBox[] = world.items.map((it) => ({
    id: it.id,
    name: it.name,
    role: it.role,
    height: it.size.h,
    footprint: it.footprint,
  }));
  const walls = world.walls.map((w) => w.footprint);
  const refs: RefPoint[] = [
    ...boxes.flatMap((b) =>
      b.footprint.flatMap((p, i): RefPoint[] => {
        const floor: RefPoint = { id: `${b.id}:f${i}`, label: `${b.name}, ${CORNER_NAMES[i]} (floor)`, world: { x: p.x, y: 0, z: p.z }, kind: "floor" };
        if (b.height < MIN_TOP_HEIGHT_M) return [floor];
        return [floor, { id: `${b.id}:t${i}`, label: `${b.name}, ${CORNER_NAMES[i]} (top)`, world: { x: p.x, y: b.height, z: p.z }, kind: "top" }];
      }),
    ),
    ...roomCorners(walls),
  ];
  const all = [...boxes.flatMap((b) => b.footprint), ...walls.flat()];
  const bounds: Bounds = {
    minX: Math.min(...all.map((p) => p.x)),
    maxX: Math.max(...all.map((p) => p.x)),
    minZ: Math.min(...all.map((p) => p.z)),
    maxZ: Math.max(...all.map((p) => p.z)),
  };
  const stands = Object.fromEntries(
    k.layout.workers.flatMap((w) => {
      const it = world.itemsById.get(w.stationId);
      return it ? [[w.id, it.stand] as const] : [];
    }),
  );
  return ok({ key: kitchenKey(k.scan), boxes, walls, refs, bounds, workers: k.layout.workers, stands });
}

export function insideBounds(b: Bounds, p: Vec2, margin: number): boolean {
  return p.x >= b.minX - margin && p.x <= b.maxX + margin && p.z >= b.minZ - margin && p.z <= b.maxZ + margin;
}
