/**
 * Auto-arrange: search for positions of the unlocked boxes that make the
 * kitchen most profitable per hour.
 *
 * Pure and synchronous, but written as a generator so the stage can run it in
 * small slices between frames (see state/auto-arrange.ts). Nothing here
 * touches the screen.
 *
 * What it ranks layouts by, in order:
 *   1. profit per hour, highest first (core/profit.ts: sales the kitchen can
 *      make in a busy hour, less wages and running costs), p50;
 *   2. when the recorded run's last order would be finished, soonest first;
 *   3. the mean order time (how long customers wait);
 *   4. walking per order.
 * When the kitchen can already make more than comes in, profit is the same for
 * every layout and the waiting times decide. Differences smaller than
 * ARRANGE_TIE_PROFIT (money) or ARRANGE_TIE_S (seconds) count as ties.
 *
 * How it searches: coordinate descent. For each movable box in turn, every
 * spot on a floor grid and every quarter turn is checked for room (inside the
 * walls, clear of other boxes, a free spot for the person who uses it). The
 * spots are ranked by exact walking per order, and the best few are simulated.
 * The box goes to the best spot if that beats where it is. Then pairs of boxes
 * try swapping places, and a fine grid polishes each box near its new spot.
 * Passes repeat until nothing improves. Finally each moved box is tried back
 * at its start; if the run is no slower without the move, the move is undone,
 * so the answer changes as little as it can.
 *
 * The search uses its own random seed, so the prediction the stage then shows
 * (seed 1, 200 runs) is not the same draws the search tuned itself to.
 */
import {
  BODY_RADIUS_M,
  buildPathTable,
  capacityPerHour,
  distance,
  predict,
  profitFromCapacity,
  resolveWorld,
  walkingPerOrder,
  withRealWork,
  type Calibration,
  type Economics,
  type Layout,
  type Placement,
  type Scan,
  type Setup,
  type Vec2,
  type World,
  type WorldItem,
} from "../../core";
import { worldToLocal, type OrientedRect } from "../../core/geometry";
import { CONTACT_GAP_M, overlaps } from "../scene/collision";
import { footprintRect, type Rect } from "../scene/model";

/** Simulated runs per candidate during the search. */
export const ARRANGE_REPS = 24;
/** Seed for the search's simulated runs (the stage's own prediction uses seed 1). */
export const ARRANGE_SEED = 7;
/** Differences smaller than this, seconds, count as a tie. */
export const ARRANGE_TIE_S = 0.05;
/** Profit differences smaller than this, per hour, count as a tie. */
export const ARRANGE_TIE_PROFIT = 0.5;
/** Coarse and fine grid spacing, metres. */
export const COARSE_STEP_M = 0.15;
export const FINE_STEP_M = 0.05;
/** Spots simulated per box per pass, after ranking by walking. */
export const SIMULATED_PER_BOX = 12;
/** A person needs this much clear floor round the spot where they stand, metres. */
export const STAND_CLEAR_M = 0.15;
/** Two people's stand points closer than this would have them in each other's way, metres. */
export const STAND_APART_M = 2 * BODY_RADIUS_M;
const MAX_PASSES = 4;
const QUARTER = Math.PI / 2;

export interface ArrangeInput {
  readonly scan: Scan;
  readonly setup: Setup;
  /** Where to start: the layout on screen. Its workers are kept. */
  readonly start: Layout;
  /** Floor area boxes may stand in (the same area a drag is held to). */
  readonly area: Rect;
  readonly calibration: Calibration;
  readonly economics: Economics;
}

export interface ArrangeScore {
  /** Profit per hour, p50, in the owner's money. */
  readonly profitPerHour: number;
  /** When the last order is finished, p50, seconds. */
  readonly runTimeS: number;
  /** Mean order time, p50, seconds. */
  readonly orderTimeS: number;
  readonly walkingM: number;
}

export interface ArrangeProgress {
  /** Rough share of the search done, 0 to 1. */
  readonly fraction: number;
  readonly best: ArrangeScore;
}

export type ArrangeResult =
  | {
      readonly ok: true;
      readonly layout: Layout;
      readonly before: ArrangeScore;
      readonly after: ArrangeScore;
      /** Box ids that moved or turned, in scan order. */
      readonly moved: readonly string[];
      readonly evaluated: number;
    }
  | { readonly ok: false; readonly reason: string };

/** Boxes the search may move: unlocked, and real things on the floor (not marks or noise). */
export function movableIds(scan: Scan, setup: Setup): readonly string[] {
  const byId = new Map(setup.items.map((i) => [i.boxId, i] as const));
  return scan.boxes
    .filter((b) => {
      const s = byId.get(b.id);
      const role = s?.role ?? "fixture";
      return !(s?.locked ?? false) && role !== "ignore" && role !== "queue";
    })
    .map((b) => b.id);
}

/** Lexicographic: profit (higher first), then run time, order time, walking. Negative when a is better. */
export function compareScores(a: ArrangeScore, b: ArrangeScore): number {
  if (Math.abs(a.profitPerHour - b.profitPerHour) > ARRANGE_TIE_PROFIT) return b.profitPerHour - a.profitPerHour;
  if (Math.abs(a.runTimeS - b.runTimeS) > ARRANGE_TIE_S) return a.runTimeS - b.runTimeS;
  if (Math.abs(a.orderTimeS - b.orderTimeS) > ARRANGE_TIE_S) return a.orderTimeS - b.orderTimeS;
  if (Math.abs(a.walkingM - b.walkingM) > 0.01) return a.walkingM - b.walkingM;
  return 0;
}

// --- geometry ---------------------------------------------------------------

function placementOf(scan: Scan, layout: Layout, id: string): Placement {
  const p = layout.placements[id];
  if (p) return p;
  const box = scan.boxes.find((b) => b.id === id);
  if (!box) throw new Error(`Unknown box "${id}"`);
  return { x: box.center.x, z: box.center.z, yaw: box.yaw };
}

function withPlacement(layout: Layout, id: string, p: Placement): Layout {
  return { ...layout, placements: { ...layout.placements, [id]: p } };
}

/** Distance from p to an oriented rectangle (0 on or inside it). */
function distanceToRect(rect: OrientedRect, p: Vec2): number {
  const l = worldToLocal(rect, p);
  return Math.hypot(Math.max(0, Math.abs(l.x) - rect.halfW), Math.max(0, Math.abs(l.z) - rect.halfD));
}

/** Stand points that people use: stations on the menu, storage fetched from, the pickup. */
function usedStands(world: World): readonly WorldItem[] {
  const used = new Set<string>([world.pickupId]);
  for (const m of world.menu) {
    for (const s of m.steps) {
      used.add(s.stationId);
      for (const f of s.fetchFrom ?? []) used.add(f);
    }
  }
  return world.items.filter((i) => used.has(i.id));
}

/**
 * Where people in this world have nowhere proper to stand, one key per
 * problem: a spot outside the room or too near a wall, on or against another
 * box, or on top of someone else's spot. Floor marks (queue) are not boxes.
 *
 * The search accepts a layout only when its problems are all ones the starting
 * layout already had, so it never makes a spot worse than the owner's own.
 */
export function standProblems(world: World, area: Rect): ReadonlySet<string> {
  const out = new Set<string>();
  const stands = usedStands(world);
  const solid = world.items.filter((i) => i.role !== "queue");
  for (const it of stands) {
    const p = it.stand;
    if (p.x < area.minX + STAND_CLEAR_M || p.x > area.maxX - STAND_CLEAR_M || p.z < area.minZ + STAND_CLEAR_M || p.z > area.maxZ - STAND_CLEAR_M) {
      out.add(`room:${it.id}`);
    }
    for (const o of solid) if (o.id !== it.id && distanceToRect(o.rect, p) < STAND_CLEAR_M) out.add(`box:${it.id}:${o.id}`);
    for (const w of world.walls) if (distanceToRect(w.rect, p) < STAND_CLEAR_M) out.add(`wall:${it.id}:${w.id}`);
  }
  for (let i = 0; i < stands.length; i += 1) {
    for (let j = i + 1; j < stands.length; j += 1) {
      const a = stands[i] as WorldItem;
      const b = stands[j] as WorldItem;
      if (distance(a.stand, b.stand) < STAND_APART_M) out.add(`apart:${a.id}:${b.id}`);
    }
  }
  return out;
}

interface Footprints {
  readonly rects: ReadonlyMap<string, Rect>;
}

function footprints(scan: Scan, setup: Setup, layout: Layout): Footprints {
  const roles = new Map(setup.items.map((i) => [i.boxId, i.role] as const));
  const rects = new Map<string, Rect>();
  for (const b of scan.boxes) {
    const role = roles.get(b.id) ?? "fixture";
    if (role === "ignore" || role === "queue") continue;
    const p = placementOf(scan, layout, b.id);
    rects.set(b.id, footprintRect(b.size, p.x, p.z, p.yaw));
  }
  return { rects };
}

function inside(r: Rect, area: Rect): boolean {
  const e = 1e-9;
  return r.minX >= area.minX - e && r.maxX <= area.maxX + e && r.minZ >= area.minZ - e && r.maxZ <= area.maxZ + e;
}

/** Quarter turns of a yaw, snapped to the nearest quarter, in [0, 2pi). */
function quarterTurns(): readonly number[] {
  return [0, QUARTER, 2 * QUARTER, 3 * QUARTER];
}

// --- the search -------------------------------------------------------------

interface Scored {
  readonly layout: Layout;
  readonly score: ArrangeScore;
}

class Evaluator {
  evaluated = 0;
  private readonly cache = new Map<string, ArrangeScore | null>();
  private readonly allowed: ReadonlySet<string>;
  /** The calibration with real work times, for capacity (core/profit.ts). */
  private readonly realWork: Calibration;

  constructor(private readonly input: ArrangeInput) {
    this.realWork = withRealWork(input.calibration, input.economics);
    let start: World | null = null;
    try {
      start = resolveWorld(input.scan, input.setup, input.start);
    } catch {
      start = null;
    }
    this.allowed = start ? standProblems(start, input.area) : new Set();
  }

  /** The world, if it resolves and nobody's spot is worse off than at the start. */
  world(layout: Layout): World | null {
    try {
      const w = resolveWorld(this.input.scan, this.input.setup, layout);
      for (const p of standProblems(w, this.input.area)) if (!this.allowed.has(p)) return null;
      return w;
    } catch {
      return null;
    }
  }

  /** Exact walking per order, or null when the layout is not usable. */
  walking(layout: Layout): number | null {
    const w = this.world(layout);
    if (!w) return null;
    try {
      const s = walkingPerOrder(w, buildPathTable(w));
      return s.anyBlocked ? null : s.perOrderM;
    } catch {
      return null;
    }
  }

  score(layout: Layout, reps = ARRANGE_REPS, seed = ARRANGE_SEED): ArrangeScore | null {
    const key = `${reps}:${seed}:${keyOf(layout)}`;
    if (this.cache.has(key)) return this.cache.get(key) ?? null;
    this.evaluated += 1;
    let out: ArrangeScore | null = null;
    const w = this.world(layout);
    if (w) {
      try {
        const table = buildPathTable(w);
        const p = predict(w, this.input.calibration, { table, reps, seed });
        const cap = capacityPerHour(w, this.realWork, { table, reps, seed });
        const money = profitFromCapacity(w, this.input.economics, cap);
        if (!p.anyBlocked) out = { profitPerHour: money.profitPerHour.p50, runTimeS: p.lastFinish.p50, orderTimeS: p.meanOrderTime.p50, walkingM: p.walkingPerOrderM };
      } catch {
        out = null;
      }
    }
    this.cache.set(key, out);
    return out;
  }
}

function keyOf(layout: Layout): string {
  const ids = Object.keys(layout.placements).sort();
  const staff = layout.workers.map((w) => `${w.id}>${w.stationId}`).join(",");
  return staff + "#" + ids
    .map((id) => {
      const p = layout.placements[id] as Placement;
      return `${id}@${p.x.toFixed(3)},${p.z.toFixed(3)},${p.yaw.toFixed(3)}`;
    })
    .join("|");
}

/** Spots for one box with the others where they are: on a grid, every quarter turn, with room. */
function spotsFor(input: ArrangeInput, layout: Layout, id: string, grid: { readonly step: number; readonly around?: Placement; readonly reach?: number }): Placement[] {
  const box = input.scan.boxes.find((b) => b.id === id);
  if (!box) return [];
  const others = [...footprints(input.scan, input.setup, layout).rects].filter(([k]) => k !== id).map(([, r]) => r);
  const a = input.area;
  const lo = grid.around ? { x: grid.around.x - (grid.reach ?? 0), z: grid.around.z - (grid.reach ?? 0) } : { x: a.minX, z: a.minZ };
  const hi = grid.around ? { x: grid.around.x + (grid.reach ?? 0), z: grid.around.z + (grid.reach ?? 0) } : { x: a.maxX, z: a.maxZ };
  const out: Placement[] = [];
  const yaws = grid.around ? [grid.around.yaw] : quarterTurns();
  for (let x = lo.x; x <= hi.x + 1e-9; x += grid.step) {
    for (let z = lo.z; z <= hi.z + 1e-9; z += grid.step) {
      for (const yaw of yaws) {
        const r = footprintRect(box.size, x, z, yaw);
        if (!inside(r, a)) continue;
        if (others.some((o) => overlaps(r, o, CONTACT_GAP_M - 1e-9))) continue;
        out.push({ x: round(x), z: round(z), yaw });
      }
    }
  }
  return out;
}

const round = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Best spot for one box, others fixed. Ranks the spots by walking (ties: the
 * smaller move first) and simulates the best few. Returns the current layout
 * when nothing beats it.
 */
function* improveBox(input: ArrangeInput, ev: Evaluator, current: Scored, id: string, step: number, fine: boolean): Generator<void, Scored> {
  const here = placementOf(input.scan, current.layout, id);
  const spots = spotsFor(input, current.layout, id, fine ? { step, around: here, reach: COARSE_STEP_M } : { step });
  const ranked: { p: Placement; walk: number; moveM: number }[] = [];
  let n = 0;
  for (const p of spots) {
    const walk = ev.walking(withPlacement(current.layout, id, p));
    if (walk !== null) ranked.push({ p, walk, moveM: Math.hypot(p.x - here.x, p.z - here.z) });
    n += 1;
    if (n % 200 === 0) yield;
  }
  ranked.sort((a, b) => a.walk - b.walk || a.moveM - b.moveM);
  let best = current;
  for (const r of ranked.slice(0, SIMULATED_PER_BOX)) {
    const layout = withPlacement(current.layout, id, r.p);
    const score = ev.score(layout);
    if (score && compareScores(score, best.score) < 0) best = { layout, score };
    yield;
  }
  return best;
}

/** Try swapping the places of two boxes (each keeps the best of its four turns). */
function* trySwaps(input: ArrangeInput, ev: Evaluator, current: Scored, ids: readonly string[]): Generator<void, Scored> {
  let best = current;
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const a = ids[i] as string;
      const b = ids[j] as string;
      const pa = placementOf(input.scan, best.layout, a);
      const pb = placementOf(input.scan, best.layout, b);
      for (const ya of quarterTurns()) {
        for (const yb of quarterTurns()) {
          const layout = withPlacement(withPlacement(best.layout, a, { x: pb.x, z: pb.z, yaw: ya }), b, { x: pa.x, z: pa.z, yaw: yb });
          if (!fits(input, layout, [a, b])) continue;
          const score = ev.score(layout);
          if (score && compareScores(score, best.score) < 0) best = { layout, score };
        }
      }
      yield;
    }
  }
  return best;
}

/** The given boxes are inside the area and clear of every other box. */
function fits(input: ArrangeInput, layout: Layout, ids: readonly string[]): boolean {
  const { rects } = footprints(input.scan, input.setup, layout);
  for (const id of ids) {
    const r = rects.get(id);
    if (!r || !inside(r, input.area)) return false;
    for (const [k, o] of rects) if (k !== id && overlaps(r, o, CONTACT_GAP_M - 1e-9)) return false;
  }
  return true;
}

/** Undo moves that do not pay for themselves. */
function* tidy(input: ArrangeInput, ev: Evaluator, current: Scored, ids: readonly string[]): Generator<void, Scored> {
  let best = current;
  for (const id of ids) {
    const start = placementOf(input.scan, input.start, id);
    const now = placementOf(input.scan, best.layout, id);
    if (start.x === now.x && start.z === now.z && start.yaw === now.yaw) continue;
    const layout = withPlacement(best.layout, id, start);
    if (!fits(input, layout, [id])) continue;
    const score = ev.score(layout);
    if (score && compareScores(score, best.score) <= 0) best = { layout, score };
    yield;
  }
  return best;
}

function movedIds(input: ArrangeInput, layout: Layout): string[] {
  return input.scan.boxes
    .map((b) => b.id)
    .filter((id) => {
      const a = placementOf(input.scan, input.start, id);
      const b = placementOf(input.scan, layout, id);
      return Math.hypot(a.x - b.x, a.z - b.z) > 1e-3 || Math.abs(a.yaw - b.yaw) > 1e-3;
    });
}

/**
 * The search, as a generator: it yields progress often (every few
 * milliseconds of work) and returns the result.
 */
export function* arrangeSteps(input: ArrangeInput): Generator<ArrangeProgress, ArrangeResult> {
  const ev = new Evaluator(input);
  const ids = movableIds(input.scan, input.setup);
  if (ids.length === 0) return { ok: false, reason: "Every box is locked, so there is nothing to move. Unlock a box in Scan to let it move." };
  const startScore = ev.score(input.start);
  if (!startScore) return { ok: false, reason: "The kitchen as it stands cannot be worked out, so there is nothing to improve on. Fix the layout first." };

  let best: Scored = { layout: input.start, score: startScore };
  // Work units: per pass, one coarse and one fine sweep per box, plus swaps.
  const unitsPerPass = 2 * ids.length + 1;
  const total = unitsPerPass * MAX_PASSES + 1;
  let units = 0;
  const progress = (): ArrangeProgress => ({ fraction: Math.min(0.99, units / total), best: best.score });

  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const before = best;
    for (const id of ids) {
      const g = improveBox(input, ev, best, id, COARSE_STEP_M, false);
      let r = g.next();
      while (!r.done) { yield progress(); r = g.next(); }
      best = r.value;
      units += 1;
    }
    {
      const g = trySwaps(input, ev, best, ids);
      let r = g.next();
      while (!r.done) { yield progress(); r = g.next(); }
      best = r.value;
      units += 1;
    }
    for (const id of ids) {
      const g = improveBox(input, ev, best, id, FINE_STEP_M, true);
      let r = g.next();
      while (!r.done) { yield progress(); r = g.next(); }
      best = r.value;
      units += 1;
    }
    if (compareScores(best.score, before.score) >= 0) break;
  }
  {
    const g = tidy(input, ev, best, ids);
    let r = g.next();
    while (!r.done) { yield progress(); r = g.next(); }
    best = r.value;
  }
  return { ok: true, layout: best.layout, before: startScore, after: best.score, moved: movedIds(input, best.layout), evaluated: ev.evaluated };
}

/** Runs the whole search at once (tests, tools). */
export function arrange(input: ArrangeInput): ArrangeResult {
  const g = arrangeSteps(input);
  let r = g.next();
  while (!r.done) r = g.next();
  return r.value;
}
