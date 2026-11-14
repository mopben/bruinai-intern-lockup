/**
 * The prediction for the next run, frozen when the judge leaves Play.
 *
 * freezePredictions takes the calibration from the FIRST run and layouts only.
 * It cannot see a second run's taps or positions: its input type has no place
 * for them. The Test step then compares a frozen entry with the second run;
 * it never recomputes a prediction. If the judge's layout matches no recorded
 * run, the nearest recorded run's layout was also predicted at freeze time
 * (still from the first run only), so a prediction is never compared with a
 * run of a different layout.
 */
import type { Calibration, Layout, Prediction, Range, Scan, Setup } from "../../core";
import { layoutNumbers } from "./numbers";

export interface FrozenEntry {
  readonly layout: Layout;
  /** null when the model could not predict this layout; `message` says why. */
  readonly prediction: Prediction | null;
  readonly message: string | null;
}

export interface FrozenPrediction {
  /** Where the calibration came from, e.g. "counter-a" or "live run". */
  readonly basis: string;
  readonly judge: FrozenEntry;
  /** By recorded run id. */
  readonly candidates: Readonly<Record<string, FrozenEntry>>;
}

export interface FreezeInput {
  readonly basis: string;
  readonly scan: Scan;
  readonly setup: Setup;
  /** Learned from the first run only. */
  readonly calibration: Calibration;
  readonly judgeLayout: Layout;
  /** Layouts of the recorded second runs. Layouts only, never their logs. */
  readonly candidateLayouts: readonly { readonly id: string; readonly layout: Layout }[];
}

function entry(input: FreezeInput, layout: Layout): FrozenEntry {
  const n = layoutNumbers(input.scan, input.setup, layout, input.calibration);
  return Object.freeze(n.time.ok ? { layout, prediction: n.time.value, message: null } : { layout, prediction: null, message: n.time.message });
}

export function freezePredictions(input: FreezeInput): FrozenPrediction {
  const candidates = Object.fromEntries(input.candidateLayouts.map((c) => [c.id, entry(input, c.layout)] as const));
  return Object.freeze({ basis: input.basis, judge: entry(input, input.judgeLayout), candidates: Object.freeze(candidates) });
}

export function frozenRange(e: FrozenEntry): Range | null {
  return e.prediction?.meanOrderTime ?? null;
}
