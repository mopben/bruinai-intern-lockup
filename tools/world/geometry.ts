/**
 * Floor geometry and routing for the world generator.
 *
 * This is the "real room": people walk around furniture here. It is written
 * separately from src/core on purpose (only types and protocol constants are
 * shared), so the fixtures are not produced by the model's own path finder.
 *
 * Rotation: a local vector (x, z) maps to world (x cos + z sin, -x sin + z cos),
 * the rotation about +y used by three.js. yaw = 0 keeps local +z facing world +z.
 */
import type { BoxSide, Vec2 } from "../../src/core/types";

export interface Rect {
  readonly cx: number;
  readonly cz: number;
  /** Half extent along local x (half of w). */
  readonly hw: number;
  /** Half extent along local z (half of d). */
  readonly hd: number;
  readonly yaw: number;
}

export const v2 = (x: number, z: number): Vec2 => ({ x, z });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, z: a.z + b.z });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, z: a.z - b.z });
export const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, z: a.z * k });
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.z - b.z);

export function toWorld(r: Rect, lx: number, lz: number): Vec2 {
  const c = Math.cos(r.yaw);
  const s = Math.sin(r.yaw);
  return { x: r.cx + lx * c + lz * s, z: r.cz - lx * s + lz * c };
}

export function toLocal(r: Rect, p: Vec2): Vec2 {
  const c = Math.cos(r.yaw);
  const s = Math.sin(r.yaw);
  const dx = p.x - r.cx;
  const dz = p.z - r.cz;
  return { x: dx * c - dz * s, z: dx * s + dz * c };
}

/** Unit vector pointing out of the given side, in world coordinates. */
export function sideNormal(r: Rect, side: BoxSide): Vec2 {
  const local: Record<BoxSide, Vec2> = { front: v2(0, 1), back: v2(0, -1), right: v2(1, 0), left: v2(-1, 0) };
  const n = local[side];
  return sub(toWorld({ ...r, cx: 0, cz: 0 }, n.x, n.z), v2(0, 0));
}

/** Where a person stands to use a side: `standOff` out from the middle of that side. */
export function standPointOf(r: Rect, side: BoxSide, standOff: number): Vec2 {
  const half = side === "front" || side === "back" ? r.hd : r.hw;
  return add(v2(r.cx, r.cz), scale(sideNormal(r, side), half + standOff));
}

/** Along-the-side direction for a side (90 degrees from its normal). */
export function sideTangent(r: Rect, side: BoxSide): Vec2 {
  const n = sideNormal(r, side);
  return v2(n.z, -n.x);
}

export function grow(r: Rect, by: number): Rect {
  return { ...r, hw: r.hw + by, hd: r.hd + by };
}

/** How far p is inside r (positive) or outside it (negative), using the nearest edge. */
export function penetration(r: Rect, p: Vec2): number {
  const l = toLocal(r, p);
  return Math.min(r.hw - Math.abs(l.x), r.hd - Math.abs(l.z));
}

export function corners(r: Rect): readonly Vec2[] {
  return [toWorld(r, -r.hw, -r.hd), toWorld(r, r.hw, -r.hd), toWorld(r, r.hw, r.hd), toWorld(r, -r.hw, r.hd)];
}

/** True when segment a-b passes through the open interior of r (Liang-Barsky). */
export function segmentEntersRect(r: Rect, a: Vec2, b: Vec2): boolean {
  const eps = 1e-6;
  const p = toLocal(r, a);
  const q = toLocal(r, b);
  const dx = q.x - p.x;
  const dz = q.z - p.z;
  let t0 = 0;
  let t1 = 1;
  const edges: readonly (readonly [number, number])[] = [
    [-dx, p.x + r.hw - eps],
    [dx, r.hw - eps - p.x],
    [-dz, p.z + r.hd - eps],
    [dz, r.hd - eps - p.z],
  ];
  for (const [den, num] of edges) {
    if (Math.abs(den) < 1e-12) {
      if (num < 0) return false;
      continue;
    }
    const t = num / den;
    if (den < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return t1 - t0 > 1e-9;
}

export interface Bounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

const inBounds = (b: Bounds, p: Vec2): boolean => p.x >= b.minX && p.x <= b.maxX && p.z >= b.minZ && p.z <= b.maxZ;

/**
 * Shortest walkable polyline from a to b around the given (already grown) obstacles,
 * by a visibility graph over obstacle corners and Dijkstra. Points of a and b are kept.
 */
export function route(a: Vec2, b: Vec2, obstacles: readonly Rect[], bounds: Bounds): readonly Vec2[] {
  const clear = (p: Vec2, q: Vec2): boolean => obstacles.every((o) => !segmentEntersRect(o, p, q));
  if (clear(a, b)) return [a, b];
  const nodeGrow = 0.02;
  const cornerNodes = obstacles
    .flatMap((o) => corners(grow(o, nodeGrow)))
    .filter((p) => inBounds(bounds, p) && obstacles.every((o) => penetration(o, p) <= 0));
  const nodes: readonly Vec2[] = [a, b, ...cornerNodes];
  const n = nodes.length;
  const best = new Array<number>(n).fill(Infinity);
  const prev = new Array<number>(n).fill(-1);
  const done = new Array<boolean>(n).fill(false);
  best[0] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < n; i += 1) if (!done[i] && (u < 0 || (best[i] as number) < (best[u] as number))) u = i;
    if (u < 0 || best[u] === Infinity) break;
    if (u === 1) break;
    done[u] = true;
    for (let w = 0; w < n; w += 1) {
      if (done[w] || w === u) continue;
      const cand = (best[u] as number) + dist(nodes[u] as Vec2, nodes[w] as Vec2);
      if (cand < (best[w] as number) && clear(nodes[u] as Vec2, nodes[w] as Vec2)) {
        best[w] = cand;
        prev[w] = u;
      }
    }
  }
  if (best[1] === Infinity) throw new Error(`No walkable path from (${a.x}, ${a.z}) to (${b.x}, ${b.z})`);
  const order: number[] = [];
  for (let i = 1; i >= 0; i = prev[i] as number) order.unshift(i);
  return order.map((i) => nodes[i] as Vec2);
}

export function pathLength(path: readonly Vec2[]): number {
  return path.slice(1).reduce((acc, p, i) => acc + dist(path[i] as Vec2, p), 0);
}

/** Point at arc length s along a polyline (clamped to its ends). */
export function pointAlong(path: readonly Vec2[], s: number): Vec2 {
  let left = Math.max(0, s);
  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1] as Vec2;
    const b = path[i] as Vec2;
    const len = dist(a, b);
    if (left <= len || i === path.length - 1) {
      const k = len === 0 ? 0 : Math.min(1, left / len);
      return add(a, scale(sub(b, a), k));
    }
    left -= len;
  }
  return path[path.length - 1] as Vec2;
}
