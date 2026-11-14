/**
 * Runs the suggestion search (app/suggest.ts) in slices between frames, so the
 * stage keeps drawing, and lets the judge put one of the suggestions on the board.
 */
import { signal } from "@preact/signals";
import { profitOf, resolveWorld, type Layout, type Range } from "../../core";
import { suggestSteps, type Suggestion } from "../app/suggest";
import { dragArea } from "../scene/model";
import { calibration, firstRunProblem, originalLayout } from "./derive";
import { economics } from "./economics";
import { kitchen, playLayout, step } from "./store";

/** Work per slice, milliseconds: short enough that the scene keeps its frame rate. */
const SLICE_MS = 12;

/** A suggestion with the stage's own profit numbers (seed 1, as on screen), not the search's draws. */
export interface ShownSuggestion {
  readonly s: Suggestion;
  readonly profit: Range;
  /** p50 profit gain per hour over the layout the search started from. */
  readonly gainPerHour: number;
  /** Mean order time p50, seconds, before and after: for when the profit does not change. */
  readonly waitBeforeS: number;
  readonly waitAfterS: number;
}

export type SuggestState =
  | { readonly kind: "idle" }
  | { readonly kind: "running"; readonly fraction: number }
  | { readonly kind: "done"; readonly start: Layout; readonly list: readonly ShownSuggestion[] }
  | { readonly kind: "failed"; readonly reason: string };

export const suggestState = signal<SuggestState>({ kind: "idle" });

let cancelJob: (() => void) | null = null;

/** Stops a search in progress and clears the list. Nothing on the board changes. */
export function cancelSuggest(): void {
  cancelJob?.();
  cancelJob = null;
  if (suggestState.value.kind !== "idle") suggestState.value = { kind: "idle" };
}

/** Puts a suggestion on the board. The list stays so another can be tried. */
export function applySuggestion(s: Suggestion): void {
  playLayout.value = s.layout;
}

/** Back to the layout the suggestions were made from. */
export function undoSuggestion(): void {
  const st = suggestState.value;
  if (st.kind === "done") playLayout.value = st.start;
}

/** Starts the search from the layout on screen; pressing again while it runs stops it. */
export function startSuggest(): void {
  if (cancelJob) {
    cancelSuggest();
    return;
  }
  const k = kitchen.value;
  const start = playLayout.value ?? originalLayout.value;
  const cal = calibration.value;
  const econ = economics.value;
  if (!k || !start || !cal || !cal.ok || !econ) {
    suggestState.value = { kind: "failed", reason: firstRunProblem.value ?? (cal && !cal.ok ? cal.message : "The model has nothing to learn from yet.") };
    return;
  }
  const gen = suggestSteps({ scan: k.scan, setup: k.setup, start, area: dragArea({ scan: k.scan, setup: k.setup }), calibration: cal.value, economics: econ });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;
  cancelJob = () => {
    cancelled = true;
    if (timer !== undefined) clearTimeout(timer);
  };
  suggestState.value = { kind: "running", fraction: 0 };

  const tick = () => {
    if (cancelled) return;
    const until = performance.now() + SLICE_MS;
    let r = gen.next();
    while (!r.done && performance.now() < until) r = gen.next();
    if (!r.done) {
      suggestState.value = { kind: "running", fraction: r.value.fraction };
      timer = setTimeout(tick, 0);
      return;
    }
    cancelJob = null;
    // The judge changed the board (or left Play) while it searched: their change wins.
    if (step.value !== "play" || (playLayout.value ?? originalLayout.value) !== start) {
      suggestState.value = { kind: "idle" };
      return;
    }
    const result = r.value;
    if (!result.ok) {
      suggestState.value = { kind: "failed", reason: result.reason };
      return;
    }
    const stage = (layout: Layout) => {
      const w = resolveWorld(k.scan, k.setup, layout);
      return profitOf(w, cal.value, econ);
    };
    const wait = (s: Suggestion) => s.score.orderTimeS;
    const before = stage(start).profitPerHour;
    const list = result.suggestions.map((s) => {
      const profit = stage(s.layout).profitPerHour;
      return { s, profit, gainPerHour: profit.p50 - before.p50, waitBeforeS: result.before.orderTimeS, waitAfterS: wait(s) };
    });
    suggestState.value = { kind: "done", start, list };
  };
  timer = setTimeout(tick, 0);
}
