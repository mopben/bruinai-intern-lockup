/**
 * Plain sentences from the numbers. Pure; every number comes from the inputs.
 */
import { checkPrediction, formatRange, formatSeconds, mean, peakQueue, summariseRun, type PredictionCheck, type Range, type RunTrace } from "../../core";

const EN_DASH = "–";

/** A measured mean, one decimal: "9.9 s". */
export function formatMeasured(s: number): string {
  return Number.isFinite(s) ? `${s.toFixed(1)} s` : "—";
}

/** The p10–p90 edges with one decimal, for checking a measured value against them. */
export function formatRangeExact(r: Range): string {
  return `${r.p10.toFixed(1)}${EN_DASH}${r.p90.toFixed(1)} s`;
}

/** A miss in seconds, never "0.0 s" for a miss that is not zero. */
export function formatMiss(s: number): string {
  return s > 0 && s < 0.05 ? "less than 0.1 s" : `${s.toFixed(1)} s`;
}

/** "Inside the range." / "Outside the range: 0.3 s slower than predicted." A miss is a miss, however small. */
export function verdictSentence(check: PredictionCheck): string {
  if (check.inside) return "Inside the range.";
  return `Outside the range: ${formatMiss(check.missByS)} ${check.side === "above" ? "slower" : "faster"} than predicted.`;
}

/**
 * What a range means, from the percentiles it carries (its "pNN" fields), so
 * the sentence follows the core if the percentiles change:
 * "The range is where we expect 8 runs in 10 to land."
 */
export function rangeMeaning(r: Range): string {
  const qs = Object.keys(r)
    .map((k) => /^p(\d+)$/.exec(k))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number(m[1]));
  if (qs.length < 2) return "";
  const share = (Math.max(...qs) - Math.min(...qs)) / 10;
  const runs = Number.isInteger(share) ? String(share) : share.toFixed(1);
  return `The range is where we expect ${runs} runs in 10 to land.`;
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
  /** "The range is where we expect 8 runs in 10 to land." */
  readonly meaning: string;
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
    meaning: rangeMeaning(predicted),
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

/** The simulated Test's bar: it never hides that it is a simulation. */
export const SIMULATED_BAR = "Simulated. Same orders, same luck.";

/** Where the ranges come from, and what the animation is: "Ranges from 200 runs. The animation is one of them." */
export function simulationBasis(reps: number): string {
  return `Ranges from ${reps} runs. The animation is one of them.`;
}

/** The busiest worker as a name and a whole percent, "Ben 91%"; null with no workers. */
export function busiestWorker(
  workers: readonly { readonly workerId: string; readonly busyShare: number }[],
  nameOf: (id: string) => string,
): string | null {
  if (workers.length === 0) return null;
  const top = workers.reduce((a, b) => (b.busyShare > a.busyShare ? b : a));
  return `${nameOf(top.workerId)} ${Math.round(top.busyShare * 100)}%`;
}

/** The station orders wait at most, by name, or "No waiting" when no station holds orders up. */
export function waitsMostAt(stationId: string | null, nameOf: (id: string) => string): string {
  return stationId === null ? "No waiting" : nameOf(stationId);
}
