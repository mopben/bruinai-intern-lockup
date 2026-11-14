/**
 * Where to draw each worker and how many tickets sit at each station, at a
 * moment of a run. Pure; recorded runs use the position log, simulated runs
 * their movement trace.
 */
import { queueAt, type MovementSegment, type PositionSample, type RunTrace, type Vec2, type WorkerDef, type World } from "../../core";
import type { WorkerInput } from "../scene";

/** Side-by-side spacing of several workers at one station, metres. */
export const SHARED_SPACING_M = 0.5;

/** Where each worker stands when not walking: their station's stand point, spread out when shared. */
export function homePositions(world: World): ReadonlyMap<string, Vec2> {
  const out = new Map<string, Vec2>();
  const byStation = new Map<string, WorkerDef[]>();
  for (const w of world.workers) byStation.set(w.stationId, [...(byStation.get(w.stationId) ?? []), w]);
  for (const [stationId, ws] of byStation) {
    const item = world.itemsById.get(stationId);
    if (!item) continue;
    const yaw = item.rect.yaw;
    ws.forEach((w, k) => {
      const off = (k - (ws.length - 1) / 2) * SHARED_SPACING_M;
      out.set(w.id, { x: item.stand.x + Math.cos(yaw) * off, z: item.stand.z - Math.sin(yaw) * off });
    });
  }
  return out;
}

/** Workers standing at home, for a still kitchen. */
export function standingWorkers(world: World): readonly WorkerInput[] {
  const home = homePositions(world);
  return world.workers.flatMap((w) => {
    const p = home.get(w.id);
    return p ? [{ id: w.id, color: w.color, x: p.x, z: p.z }] : [];
  });
}

/** The latest sample per worker (scanning from the end, stopping once every worker is found). */
export function latestPositions(samples: readonly PositionSample[], workers: readonly WorkerDef[]): readonly WorkerInput[] {
  const want = new Map(workers.map((w) => [w.id, w] as const));
  const found = new Map<string, WorkerInput>();
  for (let i = samples.length - 1; i >= 0 && found.size < want.size; i -= 1) {
    const s = samples[i] as PositionSample;
    const w = want.get(s.workerId);
    if (w && !found.has(s.workerId)) found.set(s.workerId, { id: w.id, color: w.color, x: s.x, z: s.z });
  }
  return workers.flatMap((w) => {
    const p = found.get(w.id);
    return p ? [p] : [];
  });
}

/** A point a fraction u (0..1) of the way along a polyline. */
export function alongPolyline(points: readonly Vec2[], u: number): Vec2 {
  if (points.length === 0) return { x: 0, z: 0 };
  if (points.length === 1) return points[0] as Vec2;
  const lens = points.slice(1).map((p, i) => Math.hypot(p.x - (points[i] as Vec2).x, p.z - (points[i] as Vec2).z));
  const total = lens.reduce((a, b) => a + b, 0);
  if (total <= 0) return points[0] as Vec2;
  let left = Math.min(1, Math.max(0, u)) * total;
  for (let i = 0; i < lens.length; i += 1) {
    const l = lens[i] as number;
    if (left <= l || i === lens.length - 1) {
      const a = points[i] as Vec2;
      const b = points[i + 1] as Vec2;
      const f = l > 0 ? Math.min(1, left / l) : 0;
      return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f };
    }
    left -= l;
  }
  return points[points.length - 1] as Vec2;
}

/** Movement segments per worker, sorted by start, for fast lookup. */
export function indexMovements(trace: RunTrace): ReadonlyMap<string, readonly MovementSegment[]> {
  const m = new Map<string, MovementSegment[]>();
  for (const s of trace.movements) {
    if (s.kind === "work") continue;
    m.set(s.workerId, [...(m.get(s.workerId) ?? []), s]);
  }
  return new Map([...m].map(([k, v]) => [k, [...v].sort((a, b) => a.t0 - b.t0)] as const));
}

/** Workers of a simulated run at time t: walking along their segment, else at home. */
export function simulatedWorkers(
  world: World,
  moves: ReadonlyMap<string, readonly MovementSegment[]>,
  t: number,
): readonly WorkerInput[] {
  const home = homePositions(world);
  return world.workers.flatMap((w) => {
    const seg = moves.get(w.id)?.find((s) => s.t0 <= t && t < s.t1);
    if (seg) {
      const p = alongPolyline(seg.path, (t - seg.t0) / Math.max(1e-6, seg.t1 - seg.t0));
      return [{ id: w.id, color: w.color, x: p.x, z: p.z, carrying: seg.kind === "carry-out" }];
    }
    const p = home.get(w.id);
    return p ? [{ id: w.id, color: w.color, x: p.x, z: p.z }] : [];
  });
}

/** Tickets at each station at time t. */
export function ticketsAtTime(trace: RunTrace, t: number): Readonly<Record<string, number>> {
  return queueAt(trace.queue, t);
}

/** Orders finished by time t. */
export function ordersDoneBy(trace: RunTrace, t: number): number {
  return trace.orders.filter((o) => o.finishedAt !== null && o.finishedAt <= t).length;
}
