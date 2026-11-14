/**
 * Optimize: the most profitable kitchen that can be made from what the owner
 * has given.
 *
 * Given, and never changed:
 *   - the equipment: every box in the scan, its size, what it is and which side
 *     people stand at. Nothing is added, removed or split. To try another
 *     machine the owner adds it by hand and optimizes again;
 *   - locked boxes, which stay exactly where they are;
 *   - the room: the floor area a drag is held to;
 *   - the recipes, prices, wages and running costs.
 * Chosen by the search:
 *   - where each unlocked box stands and which way it faces;
 *   - how many people work, and at which station each of them stands.
 *
 * Ranked by the same score as auto-arrange: profit per hour first (sales the
 * kitchen can make in a busy hour, less every worker's wage and the running
 * costs), then how soon orders are ready.
 *
 * How it searches. Staffing and arrangement are improved in turn until neither
 * helps:
 *   1. Staffing, boxes where they are: from the team on screen, try one worker
 *      more at a station, one fewer, or one moved to another station; take the
 *      best and repeat. (When no single step pays, two more at once are tried,
 *      for a kitchen with two equal bottlenecks.)
 *   2. Arrangement for that team: auto-arrange from the owner's layout, and
 *      again from a few scrambled starting arrangements, keeping the best.
 *   3. Staffing again in the new arrangement, and the boxes once more if the
 *      team changed.
 * The answer is returned only when it beats the kitchen on screen.
 *
 * People at one station are the same to the model, so only wages tell them
 * apart: when someone has to go, it is whoever at that station is paid most; a
 * new worker is paid the default wage. Someone let go is kept and moved
 * instead of hiring, unless a new hire would be cheaper.
 *
 * A generator, like auto-arrange, so the stage can run it between frames.
 */
import {
  buildPathTable,
  capacityPerHour,
  mulberry32,
  predict,
  profitFromCapacity,
  resolveWorld,
  type Economics,
  type Layout,
  type WorkerDef,
} from "../../core";
import { placementOf, withPlacement } from "../scene/model";
import {
  ARRANGE_REPS,
  ARRANGE_SEED,
  COARSE_STEP_M,
  arrangeSteps,
  compareScores,
  movableIds,
  spotsFor,
  standProblems,
  type ArrangeInput,
  type ArrangeProgress,
  type ArrangeScore,
} from "./auto-arrange";
import { addWorker } from "./kitchen-edit";
import { explainError } from "./numbers";

/** Most people the search will put at one station. */
export const MAX_PER_STATION = 4;
/** Scrambled starting arrangements tried besides the owner's own. */
export const RESTARTS = 2;
/** Seed for the scrambles, so the same kitchen gives the same answer. */
export const OPTIMIZE_SEED = 11;
/** Staffing-then-boxes rounds after the first. */
const MAX_ROUNDS = 2;
/** Grid for scrambled starts, metres. */
const SCRAMBLE_STEP_M = 2 * COARSE_STEP_M;
const SCRAMBLE_TRIES = 6;
const SPOT_TRIES = 12;

export interface StationStaff {
  readonly stationId: string;
  readonly before: number;
  readonly after: number;
}

export interface Reassignment {
  readonly worker: WorkerDef;
  readonly from: string;
  readonly to: string;
}

export type OptimizeResult =
  | {
      readonly ok: true;
      /** The best kitchen found; the starting layout itself (same object) when nothing beats it. */
      readonly layout: Layout;
      /** Search score of the kitchen on screen; null when it could not be worked at all (a station with nobody). */
      readonly before: ArrangeScore | null;
      readonly after: ArrangeScore;
      readonly changed: boolean;
      /** Boxes moved or turned, in scan order. */
      readonly moved: readonly string[];
      /** Stations whose number of workers changed. */
      readonly staff: readonly StationStaff[];
      readonly hired: readonly WorkerDef[];
      readonly removed: readonly WorkerDef[];
      readonly reassigned: readonly Reassignment[];
    }
  | { readonly ok: false; readonly reason: string };

interface Scored {
  readonly layout: Layout;
  readonly score: ArrangeScore;
}

/** Stations on any recipe, in route order, once each. */
export function routeStations(input: Pick<ArrangeInput, "setup">): readonly string[] {
  return [...new Set(input.setup.menu.flatMap((m) => m.steps.map((s) => s.stationId)))];
}

/** One layout's search score (same draws as auto-arrange), or null when it cannot be worked out. */
export function scoreLayout(input: ArrangeInput, layout: Layout): ArrangeScore | null {
  try {
    const w = resolveWorld(input.scan, input.setup, layout);
    const table = buildPathTable(w);
    const p = predict(w, input.calibration, { table, reps: ARRANGE_REPS, seed: ARRANGE_SEED });
    if (p.anyBlocked) return null;
    const cap = capacityPerHour(w, input.calibration, { table, reps: ARRANGE_REPS, seed: ARRANGE_SEED });
    return {
      profitPerHour: profitFromCapacity(w, input.economics, cap).profitPerHour.p50,
      runTimeS: p.lastFinish.p50,
      orderTimeS: p.meanOrderTime.p50,
      walkingM: p.walkingPerOrderM,
    };
  } catch {
    return null;
  }
}

/** Why a layout has no score, in words for the screen. */
function whyNot(input: ArrangeInput, layout: Layout): string {
  try {
    const w = resolveWorld(input.scan, input.setup, layout);
    const p = predict(w, input.calibration, { reps: 1, seed: ARRANGE_SEED });
    if (p.anyBlocked) return "Someone cannot reach where they need to go in the kitchen as it stands. Move a box out of the way first.";
  } catch (error) {
    return explainError(error);
  }
  return "The kitchen as it stands cannot be worked out, so there is nothing to improve on. Fix the layout first.";
}

class Scorer {
  private readonly cache = new Map<string, ArrangeScore | null>();
  constructor(private readonly input: ArrangeInput) {}

  score(layout: Layout): ArrangeScore | null {
    const key = `${layout.workers.map((w) => `${w.id}>${w.stationId}`).sort().join(",")}#${JSON.stringify(layout.placements)}`;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const out = scoreLayout(this.input, layout);
    this.cache.set(key, out);
    return out;
  }
}

// --- staffing ---------------------------------------------------------------

const wageOf = (econ: Economics, w: WorkerDef) => econ.workerWages?.[w.id] ?? econ.wagePerHour;

function countAt(layout: Layout, stationId: string): number {
  return layout.workers.reduce((n, w) => n + (w.stationId === stationId ? 1 : 0), 0);
}

/** The worker who goes when a station loses one: the best paid there, the newest among equals. */
function leaver(layout: Layout, stationId: string, econ: Economics): WorkerDef | null {
  let out: WorkerDef | null = null;
  for (const w of layout.workers) {
    if (w.stationId !== stationId) continue;
    if (!out || wageOf(econ, w) >= wageOf(econ, out)) out = w;
  }
  return out;
}

function dropAt(layout: Layout, stationId: string, econ: Economics): Layout {
  const gone = leaver(layout, stationId, econ);
  return gone ? { ...layout, workers: layout.workers.filter((w) => w !== gone) } : layout;
}

/** The newest worker at `from` goes to stand at `to`; everything else about them stays. */
function moveBetween(layout: Layout, from: string, to: string): Layout {
  const index = layout.workers.map((w) => w.stationId).lastIndexOf(from);
  if (index < 0) return layout;
  return { ...layout, workers: layout.workers.map((w, i) => (i === index ? { ...w, stationId: to } : w)) };
}

/** A worker at every station on a recipe: the least a kitchen needs to run at all. */
export function staffEveryStation(input: Pick<ArrangeInput, "setup">, layout: Layout): Layout {
  let out = layout;
  for (const id of routeStations(input)) if (countAt(out, id) === 0) out = addWorker(out, id);
  return out;
}

/**
 * Teams one step away: a worker more at a station, one fewer, or one moved to
 * another station. Stations on a recipe keep at least one worker; a worker
 * standing where no recipe goes can only leave or move to where one does.
 */
export function staffNeighbours(input: Pick<ArrangeInput, "setup" | "economics">, layout: Layout): readonly Layout[] {
  const route = routeStations(input);
  const onRoute = new Set(route);
  const idle = [...new Set(layout.workers.map((w) => w.stationId))].filter((id) => !onRoute.has(id));
  const spare = (id: string) => countAt(layout, id) > (onRoute.has(id) ? 1 : 0);
  const room = (id: string) => countAt(layout, id) < MAX_PER_STATION;
  const out: Layout[] = [];
  for (const id of route) if (room(id)) out.push(addWorker(layout, id));
  for (const id of [...route, ...idle]) if (spare(id)) out.push(dropAt(layout, id, input.economics));
  for (const from of [...route, ...idle]) {
    if (!spare(from)) continue;
    for (const to of route) if (to !== from && room(to)) out.push(moveBetween(layout, from, to));
  }
  return out;
}

/** Two more workers at once (at one station or two), for when no single step pays. */
function doubleAdds(input: Pick<ArrangeInput, "setup">, layout: Layout): readonly Layout[] {
  const route = routeStations(input);
  const out: Layout[] = [];
  for (let i = 0; i < route.length; i += 1) {
    for (let j = i; j < route.length; j += 1) {
      const a = route[i] as string;
      const b = route[j] as string;
      const one = addWorker(layout, a);
      if (countAt(layout, a) < MAX_PER_STATION && countAt(one, b) < MAX_PER_STATION) out.push(addWorker(one, b));
    }
  }
  return out;
}

/** The best team for the boxes where they are, by steepest climb from the team given. */
function* climbStaff(input: ArrangeInput, sc: Scorer, start: Scored, fraction: number): Generator<ArrangeProgress, Scored> {
  let best = start;
  // Every accepted step is strictly better, so this ends; the bound is a backstop.
  for (let step = 0; step < 4 * MAX_PER_STATION * Math.max(1, routeStations(input).length); step += 1) {
    let next = best;
    for (const tries of [staffNeighbours, doubleAdds]) {
      for (const layout of tries(input, best.layout)) {
        const score = sc.score(layout);
        yield { fraction, best: best.score };
        if (score && compareScores(score, next.score) < 0) next = { layout, score };
      }
      if (next !== best) break;
    }
    if (next === best) break;
    best = next;
  }
  return best;
}

// --- arrangement ------------------------------------------------------------

/**
 * A random arrangement of the unlocked boxes that people can still work in:
 * each box in turn goes to a random free spot where nobody's standing place is
 * worse than in the owner's layout. Null when none is found in a few tries.
 */
function scramble(input: ArrangeInput, home: Layout, staffed: Layout, sc: Scorer, rng: () => number): Layout | null {
  let allowed: ReadonlySet<string>;
  try {
    allowed = standProblems(resolveWorld(input.scan, input.setup, home), input.area);
  } catch {
    return null;
  }
  const usable = (layout: Layout): boolean => {
    try {
      for (const p of standProblems(resolveWorld(input.scan, input.setup, layout), input.area)) if (!allowed.has(p)) return false;
      return true;
    } catch {
      return false;
    }
  };
  const ids = [...movableIds(input.scan, input.setup)];
  for (let attempt = 0; attempt < SCRAMBLE_TRIES; attempt += 1) {
    for (let i = ids.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [ids[i], ids[j]] = [ids[j] as string, ids[i] as string];
    }
    let layout = staffed;
    for (const id of ids) {
      const spots = spotsFor(input, layout, id, { step: SCRAMBLE_STEP_M });
      for (let t = 0; t < SPOT_TRIES && spots.length > 0; t += 1) {
        const tried = withPlacement(layout, id, spots[Math.floor(rng() * spots.length)] as (typeof spots)[number]);
        if (usable(tried)) {
          layout = tried;
          break;
        }
      }
    }
    if (layout !== staffed && sc.score(layout)) return layout;
  }
  return null;
}

function* runArrange(input: ArrangeInput, from: number, to: number, floor: Scored): Generator<ArrangeProgress, Scored | null> {
  const g = arrangeSteps(input);
  let r = g.next();
  while (!r.done) {
    const best = compareScores(r.value.best, floor.score) < 0 ? r.value.best : floor.score;
    yield { fraction: from + (to - from) * r.value.fraction, best };
    r = g.next();
  }
  return r.value.ok ? { layout: r.value.layout, score: r.value.after } : null;
}

// --- the answer in the owner's terms ------------------------------------------

/**
 * Keeps people where it costs nothing: someone let go and someone hired become
 * one person changing station, unless the new hire would be paid less.
 */
function keepPeople(input: ArrangeInput, home: Layout, layout: Layout): Layout {
  const now = new Set(layout.workers.map((w) => w.id));
  const then = new Set(home.workers.map((w) => w.id));
  const removed = home.workers.filter((w) => !now.has(w.id)).sort((a, b) => wageOf(input.economics, a) - wageOf(input.economics, b));
  let workers = layout.workers;
  for (const hire of layout.workers.filter((w) => !then.has(w.id))) {
    const stay = removed[0];
    if (!stay || wageOf(input.economics, stay) > wageOf(input.economics, hire)) break;
    removed.shift();
    workers = workers.map((w) => (w === hire ? { ...stay, stationId: hire.stationId } : w));
  }
  return workers === layout.workers ? layout : { ...layout, workers };
}

function movedBoxes(input: ArrangeInput, home: Layout, layout: Layout): string[] {
  return input.scan.boxes
    .map((b) => b.id)
    .filter((id) => {
      const a = placementOf(id, { scan: input.scan, layout: home });
      const b = placementOf(id, { scan: input.scan, layout });
      return Math.hypot(a.x - b.x, a.z - b.z) > 1e-3 || Math.abs(a.yaw - b.yaw) > 1e-3;
    });
}

function describeChange(input: ArrangeInput, home: Layout, layout: Layout) {
  const then = new Map(home.workers.map((w) => [w.id, w] as const));
  const now = new Map(layout.workers.map((w) => [w.id, w] as const));
  const stations = [...new Set([...routeStations(input), ...home.workers.map((w) => w.stationId), ...layout.workers.map((w) => w.stationId)])];
  return {
    moved: movedBoxes(input, home, layout),
    staff: stations.map((stationId) => ({ stationId, before: countAt(home, stationId), after: countAt(layout, stationId) })).filter((s) => s.before !== s.after),
    hired: layout.workers.filter((w) => !then.has(w.id)),
    removed: home.workers.filter((w) => !now.has(w.id)),
    reassigned: layout.workers.flatMap((w) => {
      const was = then.get(w.id);
      return was && was.stationId !== w.stationId ? [{ worker: w, from: was.stationId, to: w.stationId }] : [];
    }),
  };
}

// --- the search -------------------------------------------------------------

export function* optimizeSteps(input: ArrangeInput): Generator<ArrangeProgress, OptimizeResult> {
  const home = input.start;
  const sc = new Scorer(input);
  const before = sc.score(home);
  // A station with nobody at it cannot be scored: staff it first, then improve on that.
  const runnable = staffEveryStation(input, home);
  const first = runnable === home ? before : sc.score(runnable);
  if (!first) return { ok: false, reason: whyNot(input, runnable) };
  yield { fraction: 0.01, best: first };

  // 1. The team, boxes where they are.
  let best: Scored = yield* climbStaff(input, sc, { layout: runnable, score: first }, 0.03);

  if (movableIds(input.scan, input.setup).length > 0) {
    // 2. The boxes for that team: from the owner's arrangement and from scrambled ones.
    const rng = mulberry32(OPTIMIZE_SEED);
    const starts: Layout[] = [best.layout];
    for (let i = 0; i < RESTARTS; i += 1) {
      const s = scramble(input, home, best.layout, sc, rng);
      if (s) starts.push(s);
      yield { fraction: 0.05, best: best.score };
    }
    const lo = 0.05;
    const hi = 0.8;
    let top = best;
    for (let i = 0; i < starts.length; i += 1) {
      const a = lo + ((hi - lo) * i) / starts.length;
      const b = lo + ((hi - lo) * (i + 1)) / starts.length;
      const r = yield* runArrange({ ...input, start: starts[i] as Layout, home }, a, b, top);
      if (r && compareScores(r.score, top.score) < 0) top = r;
    }
    best = top;

    // 3. The team again in the new arrangement; the boxes again if the team changed.
    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      const a = hi + ((0.98 - hi) * round) / MAX_ROUNDS;
      const b = hi + ((0.98 - hi) * (round + 1)) / MAX_ROUNDS;
      const staffed = yield* climbStaff(input, sc, best, a);
      if (staffed === best) break;
      best = staffed;
      const r = yield* runArrange({ ...input, start: best.layout, home }, a, b, best);
      if (r && compareScores(r.score, best.score) < 0) best = r;
    }
  }

  const kept = keepPeople(input, home, best.layout);
  if (kept !== best.layout) {
    const score = sc.score(kept);
    if (score && compareScores(score, best.score) <= 0) best = { layout: kept, score };
  }
  const nothing = { moved: [], staff: [], hired: [], removed: [], reassigned: [] };
  if (before && compareScores(best.score, before) >= 0) return { ok: true, layout: home, before, after: before, changed: false, ...nothing };
  return { ok: true, layout: best.layout, before, after: best.score, changed: best.layout !== home, ...describeChange(input, home, best.layout) };
}

/** Runs the whole search at once (tests, tools). */
export function optimize(input: ArrangeInput): OptimizeResult {
  const g = optimizeSteps(input);
  let r = g.next();
  while (!r.done) r = g.next();
  return r.value;
}
