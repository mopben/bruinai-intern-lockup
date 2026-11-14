/**
 * Floor geometry: oriented rectangles and segment tests.
 *
 * Rotation convention (matches three.js `rotation.y = yaw`): a local floor
 * vector (x, z) maps to world as
 *   x' =  x cos(yaw) + z sin(yaw)
 *   z' = -x sin(yaw) + z cos(yaw)
 * so yaw = 0 leaves local +z ("front") facing world +z.
 */
import type { Vec2 } from "./types";

/** An oriented rectangle on the floor. halfW along local x, halfD along local z. */
export interface OrientedRect {
  readonly center: Vec2;
  readonly halfW: number;
  readonly halfD: number;
  readonly yaw: number;
}

/** Tolerance for "touching is not crossing" tests, in metres. */
export const GEOM_EPS = 1e-7;

export function vec(x: number, z: number): Vec2 {
  return { x, z };
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function polylineLength(points: readonly Vec2[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += distance(points[i - 1] as Vec2, points[i] as Vec2);
  }
  return total;
}

/** Local (box frame) offset to world point. */
export function localToWorld(rect: OrientedRect, local: Vec2): Vec2 {
  const c = Math.cos(rect.yaw);
  const s = Math.sin(rect.yaw);
  return {
    x: rect.center.x + local.x * c + local.z * s,
    z: rect.center.z - local.x * s + local.z * c,
  };
}

/** World point to the box's local frame (inverse of localToWorld). */
export function worldToLocal(rect: OrientedRect, p: Vec2): Vec2 {
  const c = Math.cos(rect.yaw);
  const s = Math.sin(rect.yaw);
  const dx = p.x - rect.center.x;
  const dz = p.z - rect.center.z;
  return { x: dx * c - dz * s, z: dx * s + dz * c };
}

/** Corners in counter-clockwise order (as seen in local x/z), starting at local (-w, -d). */
export function rectCorners(rect: OrientedRect): readonly Vec2[] {
  const { halfW: w, halfD: d } = rect;
  return [vec(-w, -d), vec(w, -d), vec(w, d), vec(-w, d)].map((p) => localToWorld(rect, p));
}

/** The same rectangle grown outward by `r` on every side (square corners). */
export function growRect(rect: OrientedRect, r: number): OrientedRect {
  return { ...rect, halfW: rect.halfW + r, halfD: rect.halfD + r };
}

/** True when p is strictly inside the rectangle (more than GEOM_EPS from its edges). */
export function pointStrictlyInside(rect: OrientedRect, p: Vec2): boolean {
  const l = worldToLocal(rect, p);
  return Math.abs(l.x) < rect.halfW - GEOM_EPS && Math.abs(l.z) < rect.halfD - GEOM_EPS;
}

/**
 * True when the segment a-b passes through the open interior of the rectangle.
 * Running along an edge or touching a corner does not count.
 * Liang-Barsky clipping against the rectangle shrunk by GEOM_EPS.
 */
export function segmentCrossesRect(rect: OrientedRect, a: Vec2, b: Vec2): boolean {
  const la = worldToLocal(rect, a);
  const lb = worldToLocal(rect, b);
  const w = rect.halfW - GEOM_EPS;
  const d = rect.halfD - GEOM_EPS;
  if (w <= 0 || d <= 0) return false;
  const dx = lb.x - la.x;
  const dz = lb.z - la.z;
  let t0 = 0;
  let t1 = 1;
  const clips: readonly (readonly [number, number])[] = [
    [-dx, la.x + w],
    [dx, w - la.x],
    [-dz, la.z + d],
    [dz, d - la.z],
  ];
  for (const [p, q] of clips) {
    if (p === 0) {
      if (q <= 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
  }
  return t1 - t0 > 1e-9;
}
