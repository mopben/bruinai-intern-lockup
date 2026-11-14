/**
 * Exact shortest walkable path on the floor.
 *
 * Obstacles are oriented rectangles already grown by the body radius. The
 * shortest Euclidean path around convex polygonal obstacles runs through
 * obstacle corners, so a visibility graph over all corners plus the two end
 * points, searched with Dijkstra, gives the exact answer.
 *
 * End-point rule: a person's stand point may sit inside the grown margin of a
 * nearby obstacle (a wall behind them, a neighbouring box). For one query, any
 * obstacle whose grown rectangle contains either end point is replaced by its
 * un-grown footprint (`raw`), so the walker may step out of the margin but
 * still cannot walk through the box itself. If an end point is inside the raw
 * footprint too, that obstacle is dropped for the query.
 */
import type { Vec2 } from "./types";
import {
  distance,
  pointStrictlyInside,
  rectCorners,
  segmentCrossesRect,
  type OrientedRect,
} from "./geometry";

export interface Obstacle {
  readonly id: string;
  /** Footprint grown by the body radius: what blocks walking. */
  readonly grown: OrientedRect;
  /** The box itself, used when an end point sits inside the grown margin. */
  readonly raw: OrientedRect;
}

export interface WalkPath {
  /** Length in metres along the polyline. */
  readonly length: number;
  /** From start to end, including both. */
  readonly points: readonly Vec2[];
  /** True when no walkable path exists and a straight line was used instead. */
  readonly blocked: boolean;
}

function effectiveRects(obstacles: readonly Obstacle[], a: Vec2, b: Vec2): readonly OrientedRect[] {
  const out: OrientedRect[] = [];
  for (const o of obstacles) {
    const touchesEnd = pointStrictlyInside(o.grown, a) || pointStrictlyInside(o.grown, b);
    if (!touchesEnd) {
      out.push(o.grown);
      continue;
    }
    const insideRaw = pointStrictlyInside(o.raw, a) || pointStrictlyInside(o.raw, b);
    if (!insideRaw) out.push(o.raw);
  }
  return out;
}

function visible(rects: readonly OrientedRect[], a: Vec2, b: Vec2): boolean {
  for (const r of rects) {
    if (segmentCrossesRect(r, a, b)) return false;
  }
  return true;
}

function dijkstra(nodes: readonly Vec2[], rects: readonly OrientedRect[]): readonly number[] | null {
  const n = nodes.length;
  const dist = new Array<number>(n).fill(Infinity);
  const prev = new Array<number>(n).fill(-1);
  const done = new Array<boolean>(n).fill(false);
  dist[0] = 0;
  for (;;) {
    let u = -1;
    let best = Infinity;
    for (let i = 0; i < n; i += 1) {
      const di = dist[i] as number;
      if (!done[i] && di < best) {
        best = di;
        u = i;
      }
    }
    if (u === -1) return null;
    if (u === 1) break;
    done[u] = true;
    const pu = nodes[u] as Vec2;
    for (let v = 0; v < n; v += 1) {
      if (done[v] || v === u) continue;
      const pv = nodes[v] as Vec2;
      const alt = best + distance(pu, pv);
      if (alt < (dist[v] as number) - 1e-12 && visible(rects, pu, pv)) {
        dist[v] = alt;
        prev[v] = u;
      }
    }
  }
  const order: number[] = [];
  for (let at = 1; at !== -1; at = prev[at] as number) order.push(at);
  return order.reverse();
}

/** Shortest walkable path from `a` to `b` around `obstacles`. Never throws. */
export function shortestPath(obstacles: readonly Obstacle[], a: Vec2, b: Vec2): WalkPath {
  const rects = effectiveRects(obstacles, a, b);
  if (visible(rects, a, b)) {
    return { length: distance(a, b), points: [a, b], blocked: false };
  }
  const corners = rects.flatMap((r) => rectCorners(r)).filter((c) => !rects.some((r) => pointStrictlyInside(r, c)));
  const nodes: readonly Vec2[] = [a, b, ...corners];
  const order = dijkstra(nodes, rects);
  if (order === null) {
    return { length: distance(a, b), points: [a, b], blocked: true };
  }
  const points = order.map((i) => nodes[i] as Vec2);
  let length = 0;
  for (let i = 1; i < points.length; i += 1) length += distance(points[i - 1] as Vec2, points[i] as Vec2);
  return { length, points, blocked: false };
}
