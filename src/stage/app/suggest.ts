/**
 * Suggestions: changes that would make the kitchen more profitable per hour.
 *
 * Tries, from the layout on screen:
 *   - one more worker at each station on the route;
 *   - one fewer at each station that has more than one;
 *   - moving the unlocked boxes (auto-arrange, app/auto-arrange.ts);
 *   - the best staffing change and then moving the boxes for it (kept only
 *     when it beats both the staffing change and the move on their own).
 * Each is ranked by the same score as auto-arrange (profit per hour first).
 * Only changes that beat the layout on screen are returned, best first.
 *
 * A generator, like auto-arrange, so the stage can run it between frames.
 */
import { compareScores, arrangeSteps, ARRANGE_REPS, ARRANGE_SEED, ARRANGE_TIE_PROFIT, type ArrangeInput, type ArrangeProgress, type ArrangeScore } from "./auto-arrange";
import { addWorker, removeWorker, workersAt } from "./kitchen-edit";
import { buildPathTable, capacityPerHour, predict, profitFromCapacity, resolveWorld, type Layout } from "../../core";

export interface StaffChange {
  readonly stationId: string;
  readonly delta: 1 | -1;
}

export interface Suggestion {
  readonly id: string;
  readonly layout: Layout;
  /** Search score of this change (the search's own simulated runs). */
  readonly score: ArrangeScore;
  /** Search profit gain per hour over the layout on screen. */
  readonly gainPerHour: number;
  readonly staff: StaffChange | null;
  /** Boxes moved or turned. */
  readonly moved: readonly string[];
}

export type SuggestResult =
  | { readonly ok: true; readonly before: ArrangeScore; readonly suggestions: readonly Suggestion[] }
  | { readonly ok: false; readonly reason: string };

/** Stations on any menu item's route, in route order, once each. */
function routeStations(input: ArrangeInput): readonly string[] {
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

/** Staffing changes one worker away from `layout`. */
export function staffChanges(input: ArrangeInput, layout: Layout): readonly { readonly staff: StaffChange; readonly layout: Layout }[] {
  const out: { staff: StaffChange; layout: Layout }[] = [];
  for (const id of routeStations(input)) {
    out.push({ staff: { stationId: id, delta: 1 }, layout: addWorker(layout, id) });
    if (workersAt(layout, id) > 1) out.push({ staff: { stationId: id, delta: -1 }, layout: removeWorker(layout, id) });
  }
  return out;
}

function* runArrange(input: ArrangeInput, from: number, to: number) {
  const g = arrangeSteps(input);
  let r = g.next();
  while (!r.done) {
    yield { fraction: from + (to - from) * r.value.fraction, best: r.value.best } satisfies ArrangeProgress;
    r = g.next();
  }
  return r.value;
}

export function* suggestSteps(input: ArrangeInput): Generator<ArrangeProgress, SuggestResult> {
  const before = scoreLayout(input, input.start);
  if (!before) return { ok: false, reason: "The kitchen as it stands cannot be worked out, so there is nothing to compare with. Fix the layout first." };
  const found: Suggestion[] = [];
  const add = (s: Omit<Suggestion, "gainPerHour" | "id">) => {
    const gain = s.score.profitPerHour - before.profitPerHour;
    if (compareScores(s.score, before) < 0 && gain > -ARRANGE_TIE_PROFIT) {
      const id = `${s.staff ? `${s.staff.delta > 0 ? "add" : "remove"}:${s.staff.stationId}` : "keep"}${s.moved.length > 0 ? `+move:${s.moved.join(",")}` : ""}`;
      if (!found.some((f) => f.id === id)) found.push({ ...s, id, gainPerHour: gain });
    }
  };

  // 1. Staffing, boxes where they are.
  let bestStaff: { staff: StaffChange; layout: Layout; score: ArrangeScore } | null = null;
  for (const c of staffChanges(input, input.start)) {
    const score = scoreLayout(input, c.layout);
    yield { fraction: 0.05, best: score ?? before };
    if (!score) continue;
    add({ layout: c.layout, score, staff: c.staff, moved: [] });
    if (compareScores(score, before) < 0 && (!bestStaff || compareScores(score, bestStaff.score) < 0)) bestStaff = { ...c, score };
  }

  // 2. Move the boxes, staffing as it is.
  const moved = yield* runArrange(input, 0.05, bestStaff ? 0.5 : 0.98);
  if (moved.ok && moved.moved.length > 0) add({ layout: moved.layout, score: moved.after, staff: null, moved: moved.moved });

  // 3. The best staffing change, then move the boxes for it.
  if (bestStaff) {
    const both = yield* runArrange({ ...input, start: bestStaff.layout }, 0.5, 0.98);
    // Only worth saying when doing both beats each part alone.
    const beatsMove = !moved.ok || moved.moved.length === 0 || compareScores(both.ok ? both.after : before, moved.after) < 0;
    if (both.ok && both.moved.length > 0 && beatsMove && compareScores(both.after, bestStaff.score) < 0) {
      add({ layout: both.layout, score: both.after, staff: bestStaff.staff, moved: both.moved });
    }
  }

  found.sort((a, b) => compareScores(a.score, b.score));
  return { ok: true, before, suggestions: found };
}

export function suggest(input: ArrangeInput): SuggestResult {
  const g = suggestSteps(input);
  let r = g.next();
  while (!r.done) r = g.next();
  return r.value;
}
