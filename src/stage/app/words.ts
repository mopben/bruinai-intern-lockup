/**
 * Plain sentences from the numbers. Pure; every number comes from the inputs.
 */
import { checkPrediction, formatRange, formatSeconds, mean, peakQueue, summariseRun, type PredictionCheck, type Range, type RunTrace } from "../../core";

const EN_DASH = "–";
/** A miss under this percent of the range edge is "just" outside; anything more is plainly outside. */
export const JUST_OUTSIDE_PCT = 5;

/** A measured mean, one decimal: "9.9 s". */
export function formatMeasured(s: number): string {
  return Number.isFinite(s) ? `${s.toFixed(1)} s` : "—";
}

/** The p10–p90 edges with one decimal, for checking a measured value against them. */
export function formatRangeExact(r: Range): string {
  return `${r.p10.toFixed(1)}${EN_DASH}${r.p90.toFixed(1)} s`;
}

/** "Inside the range." / "Just outside the range: 0.3 s slower than predicted." */
export function verdictSentence(check: PredictionCheck): string {
  if (check.inside) return "Inside the range.";
  const by = `${check.missByS.toFixed(1)} s ${check.side === "above" ? "slower" : "faster"} than predicted`;
  return check.missByPct < JUST_OUTSIDE_PCT ? `Just outside the range: ${by}.` : `Outside the range: ${by}.`;
}

export interface TestOutcome {
  readonly check: PredictionCheck;
  readonly measuredS: number;
  readonly predicted: Range;
  /** "Predicted 8–10 s (8.8–9.7 s before rounding). Measured 9.9 s." */
  readonly headline: string;
  readonly verdict: string;
  /** "Before 20.8 s → after 9.9 s. Predicted about 9 s." or null when the first run has no finished orders. */
  readonly change: string | null;
  readonly completed: number;
  readonly total: number;
}

/**
 * Compares a frozen predicted range with the second run as measured.
 * Returns null when the second run finished no orders (nothing to compare).
 */
export function testOutcome(predicted: Range, second: RunTrace, firstMeasuredS: number | null): TestOutcome | null {
  const s = summariseRun(second);
  if (s.meanOrderTimeS === null) return null;
  const measured = s.meanOrderTimeS;
  const check = checkPrediction(predicted, measured);
  const shown = formatRange(predicted);
  const exact = formatRangeExact(predicted);
  return {
    check,
    measuredS: measured,
    predicted,
    headline: `Predicted ${shown}${shown.startsWith("about") ? "" : ` (${exact} before rounding)`}. Measured ${formatMeasured(measured)}.`,
    verdict: verdictSentence(check),
    change:
      firstMeasuredS === null
        ? null
        : `Before ${formatMeasured(firstMeasuredS)} → after ${formatMeasured(measured)}. Predicted about ${formatSeconds(predicted.p50)}.`,
    completed: s.completed,
    total: s.total,
  };
}

/** Mean time an order spent at each station (waiting plus work), seconds. */
export function timeAtStations(run: RunTrace): Readonly<Record<string, number>> {
  const by = new Map<string, number[]>();
  for (const o of run.orders) {
    for (const st of o.steps) {
      if (st.arrivedAt === null || st.doneAt === null) continue;
      by.set(st.stationId, [...(by.get(st.stationId) ?? []), st.doneAt - st.arrivedAt]);
    }
  }
  return Object.fromEntries([...by].map(([id, v]) => [id, mean(v)] as const));
}

export interface RunStory {
  /** Station where orders spent longest, or null when nothing finished a step. */
  readonly slowestId: string | null;
  /** "Orders waited longest at Espresso machine: 14 s each, up to 5 at once." */
  readonly sentence: string;
}

/** One plain sentence about where the run got stuck, from the data. */
export function runStory(run: RunTrace, nameOf: (id: string) => string): RunStory {
  const times = timeAtStations(run);
  const entries = Object.entries(times).filter(([, v]) => Number.isFinite(v));
  if (entries.length === 0) return { slowestId: null, sentence: "No step was finished, so there is nothing to say about this run yet." };
  const [slowestId, seconds] = entries.reduce((a, b) => (b[1] > a[1] ? b : a));
  const peak = peakQueue(run.queue)[slowestId] ?? 0;
  const pile = peak >= 2 ? `, up to ${peak} at once` : "";
  return { slowestId, sentence: `Orders waited longest at ${nameOf(slowestId)}: ${formatSeconds(seconds)} each on average${pile}.` };
}

/** "faster" / "slower" / "about the same", comparing two medians with whole-second rounding. */
export function changeDirection(before: number, after: number): "faster" | "slower" | "about the same" {
  const d = Math.round(after) - Math.round(before);
  if (d === 0) return "about the same";
  return d < 0 ? "faster" : "slower";
}
