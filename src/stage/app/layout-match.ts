/**
 * Does the judge's layout match a recorded second run? Pure.
 *
 * Two layouts match when every box sits within MATCH_TOLERANCE_M of the same
 * place, every box people stand at (station, storage, pickup) has its stand
 * point within the same distance, and the same number of workers stand at each
 * station. Stand points are compared, not only centres, because a fridge
 * turned the other way is a different walk for the model.
 */
import { standPoint, type BoxSide, type Layout, type RunMeta, type Scan, type Setup, type Vec2 } from "../../core";
import { resolveItems } from "../scene/model";

export const MATCH_TOLERANCE_M = 0.45;
const STANDING_ROLES = new Set(["station", "storage", "pickup"]);

export interface Candidate {
  readonly id: string;
  readonly meta: RunMeta;
  /** The layout the recorded run was made in. Only the layout: never its taps or positions. */
  readonly layout: Layout;
  /** Folder URL of the run, for loading its logs in the Test step. */
  readonly url?: string;
}

interface Spot {
  readonly id: string;
  readonly centre: Vec2;
  readonly stand: Vec2 | null;
}

function spots(scan: Scan, setup: Setup, layout: Layout): ReadonlyMap<string, Spot> {
  const sides = new Map(setup.items.map((i) => [i.boxId, i.standSide ?? "front"] as const));
  const out = new Map<string, Spot>();
  for (const it of resolveItems({ scan, setup, layout })) {
    if (it.role === "ignore") continue;
    const rect = { center: { x: it.x, z: it.z }, halfW: it.size.w / 2, halfD: it.size.d / 2, yaw: it.yaw };
    const side: BoxSide = sides.get(it.id) ?? "front";
    out.set(it.id, { id: it.id, centre: rect.center, stand: STANDING_ROLES.has(it.role) ? standPoint(rect, side) : null });
  }
  return out;
}

const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);

function staffing(layout: Layout): ReadonlyMap<string, number> {
  const m = new Map<string, number>();
  for (const w of layout.workers) m.set(w.stationId, (m.get(w.stationId) ?? 0) + 1);
  return m;
}

/** How far apart two layouts are: metres moved plus 2 per worker added or removed. */
export function layoutDistance(scan: Scan, setup: Setup, a: Layout, b: Layout): number {
  const sa = spots(scan, setup, a);
  const sb = spots(scan, setup, b);
  let total = 0;
  for (const [id, x] of sa) {
    const y = sb.get(id);
    if (!y) {
      total += 1;
      continue;
    }
    total += dist(x.centre, y.centre) + (x.stand && y.stand ? dist(x.stand, y.stand) : 0);
  }
  const wa = staffing(a);
  const wb = staffing(b);
  for (const id of new Set([...wa.keys(), ...wb.keys()])) total += 2 * Math.abs((wa.get(id) ?? 0) - (wb.get(id) ?? 0));
  return total;
}

export function layoutsMatch(scan: Scan, setup: Setup, a: Layout, b: Layout, tolerance = MATCH_TOLERANCE_M): boolean {
  const sa = spots(scan, setup, a);
  const sb = spots(scan, setup, b);
  if (sa.size !== sb.size) return false;
  for (const [id, x] of sa) {
    const y = sb.get(id);
    if (!y || dist(x.centre, y.centre) > tolerance) return false;
    if (x.stand && y.stand && dist(x.stand, y.stand) > tolerance) return false;
  }
  const wa = staffing(a);
  const wb = staffing(b);
  if (wa.size !== wb.size) return false;
  return [...wa].every(([id, n]) => wb.get(id) === n);
}

export type MatchResult =
  | { readonly kind: "match"; readonly candidate: Candidate }
  | { readonly kind: "nearest"; readonly candidate: Candidate }
  | { readonly kind: "none" };

/** The recorded run made in the judge's layout, or else the nearest one. */
export function matchRecordedRun(scan: Scan, setup: Setup, judge: Layout, candidates: readonly Candidate[]): MatchResult {
  if (candidates.length === 0) return { kind: "none" };
  const exact = candidates.find((c) => layoutsMatch(scan, setup, judge, c.layout));
  if (exact) return { kind: "match", candidate: exact };
  const nearest = candidates.reduce((best, c) =>
    layoutDistance(scan, setup, judge, c.layout) < layoutDistance(scan, setup, judge, best.layout) ? c : best,
  );
  return { kind: "nearest", candidate: nearest };
}

export type ChangeKind = "move" | "staff" | "other";

/** What a recorded run changed relative to the base layout: moved things, or added people. */
export function changeKind(scan: Scan, setup: Setup, base: Layout, changed: Layout): ChangeKind {
  const sa = staffing(base);
  const sb = staffing(changed);
  const staffChanged = base.workers.length !== changed.workers.length || [...sa].some(([id, n]) => sb.get(id) !== n);
  const moved = !layoutsMatch(scan, setup, base, { ...changed, workers: base.workers }, 0.05);
  if (staffChanged && !moved) return "staff";
  if (moved && !staffChanged) return "move";
  return "other";
}
