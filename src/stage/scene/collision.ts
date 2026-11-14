/**
 * Pure: where a dragged box may go. Keeps the box inside the room and out of
 * other boxes. When the target is blocked the box slides along the obstacle
 * instead of stopping dead, and the result is stable (no jitter) because the
 * same input always gives the same output.
 */
import type { Rect } from "./model";

/** Gap kept between boxes, metres. */
export const CONTACT_GAP_M = 0.02;

export interface MoveRequest {
  /** Half extents of the moving box on the floor. */
  readonly hx: number;
  readonly hz: number;
  /** Where the box is now (assumed valid). */
  readonly from: { readonly x: number; readonly z: number };
  /** Where the pointer wants it. */
  readonly to: { readonly x: number; readonly z: number };
  readonly area: Rect;
  readonly obstacles: readonly Rect[];
}

function rectAt(x: number, z: number, hx: number, hz: number): Rect {
  return { minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz };
}

export function overlaps(a: Rect, b: Rect, gap = 0): boolean {
  return a.minX < b.maxX + gap && a.maxX > b.minX - gap && a.minZ < b.maxZ + gap && a.maxZ > b.minZ - gap;
}

export function clampToArea(x: number, z: number, hx: number, hz: number, area: Rect): { x: number; z: number } {
  const cx = area.maxX - area.minX < 2 * hx ? (area.minX + area.maxX) / 2 : Math.min(area.maxX - hx, Math.max(area.minX + hx, x));
  const cz = area.maxZ - area.minZ < 2 * hz ? (area.minZ + area.maxZ) / 2 : Math.min(area.maxZ - hz, Math.max(area.minZ + hz, z));
  return { x: cx, z: cz };
}

function isFree(x: number, z: number, hx: number, hz: number, obstacles: readonly Rect[]): boolean {
  const r = rectAt(x, z, hx, hz);
  return obstacles.every((o) => !overlaps(r, o, CONTACT_GAP_M - 1e-9));
}

/** Move along one axis from a valid position, stopping at the first obstacle face. */
function sweepAxis(
  pos: { x: number; z: number },
  target: number,
  axis: "x" | "z",
  hx: number,
  hz: number,
  obstacles: readonly Rect[],
): { x: number; z: number } {
  const start = rectAt(pos.x, pos.z, hx, hz);
  const delta = target - pos[axis];
  if (delta === 0) return pos;
  let limit = target;
  for (const o of obstacles) {
    if (overlaps(start, o, CONTACT_GAP_M - 1e-9)) continue; // started inside: let it escape
    const crossOverlap =
      axis === "x"
        ? start.minZ < o.maxZ + CONTACT_GAP_M && start.maxZ > o.minZ - CONTACT_GAP_M
        : start.minX < o.maxX + CONTACT_GAP_M && start.maxX > o.minX - CONTACT_GAP_M;
    if (!crossOverlap) continue;
    const half = axis === "x" ? hx : hz;
    if (delta > 0) {
      const face = (axis === "x" ? o.minX : o.minZ) - CONTACT_GAP_M - half;
      if (face >= pos[axis] - 1e-9) limit = Math.min(limit, face);
    } else {
      const face = (axis === "x" ? o.maxX : o.maxZ) + CONTACT_GAP_M + half;
      if (face <= pos[axis] + 1e-9) limit = Math.max(limit, face);
    }
  }
  return axis === "x" ? { x: limit, z: pos.z } : { x: pos.x, z: limit };
}

/**
 * Resolve a drag step. If the spot under the pointer is free the box goes
 * there. Otherwise it slides from where it is toward the target, trying both
 * axis orders and keeping the one that ends nearer the pointer.
 */
export function resolveMove(req: MoveRequest): { x: number; z: number } {
  const { hx, hz, area, obstacles } = req;
  const target = clampToArea(req.to.x, req.to.z, hx, hz, area);
  if (isFree(target.x, target.z, hx, hz, obstacles)) return target;
  const from = clampToArea(req.from.x, req.from.z, hx, hz, area);
  const a = sweepAxis(sweepAxis(from, target.x, "x", hx, hz, obstacles), target.z, "z", hx, hz, obstacles);
  const b = sweepAxis(sweepAxis(from, target.z, "z", hx, hz, obstacles), target.x, "x", hx, hz, obstacles);
  const da = (a.x - target.x) ** 2 + (a.z - target.z) ** 2;
  const db = (b.x - target.x) ** 2 + (b.z - target.z) ** 2;
  return da <= db ? a : b;
}
