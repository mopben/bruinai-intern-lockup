/**
 * Runs the optimizer (app/optimize.ts) in slices between frames, so the stage
 * keeps drawing, and lets the judge put its answer on the board.
 */
import { effect, signal, untracked } from "@preact/signals";
import { profitOf, resolveWorld, type Layout, type ProfitEstimate } from "../../core";
import { optimizeSteps, type OptimizeResult } from "../app/optimize";
import { dragArea } from "../scene/model";
import { calibration, firstRunProblem, originalLayout } from "./derive";
import { economics } from "./economics";
import { kitchen, playLayout, view } from "./store";

/** Work per slice, milliseconds: short enough that the scene keeps its frame rate. */
const SLICE_MS = 12;

/** The optimizer's answer with the stage's own profit numbers (seed 1, as on screen), not the search's draws. */
export interface ShownPlan {
  readonly result: Extract<OptimizeResult, { ok: true }>;
  /** The layout the search started from. */
  readonly start: Layout;
  /** Null when the starting kitchen could not be run at all. */
  readonly profitBefore: ProfitEstimate | null;
  readonly profitAfter: ProfitEstimate | null;
}

export type OptimizeState =
  | { readonly kind: "idle" }
  | { readonly kind: "running"; readonly fraction: number }
  | { readonly kind: "done"; readonly plan: ShownPlan }
  | { readonly kind: "failed"; readonly reason: string };

export const optimizeState = signal<OptimizeState>({ kind: "idle" });

let cancelJob: (() => void) | null = null;

/** Stops a search in progress and clears the answer. Nothing on the board changes. */
export function cancelOptimize(): void {
  cancelJob?.();
  cancelJob = null;
  if (optimizeState.value.kind !== "idle") optimizeState.value = { kind: "idle" };
}

// Any correction to the kitchen (a box added, removed, locked or re-typed, a recipe changed) makes
// the answer out of date: the owner optimizes again for the new equipment.
effect(() => {
  void kitchen.value;
  untracked(cancelOptimize);
});

/** Puts the optimized kitchen on the board. The answer stays, so it can be undone. */
export function applyOptimized(): void {
  const st = optimizeState.value;
  if (st.kind === "done") playLayout.value = st.plan.result.layout;
}

/** Back to the layout the search started from. */
export function undoOptimized(): void {
  const st = optimizeState.value;
  if (st.kind === "done") playLayout.value = st.plan.start;
}

/** Starts the search from the layout on screen; pressing again while it runs stops it. */
export function startOptimize(): void {
  if (cancelJob) {
    cancelOptimize();
    return;
  }
  const k = kitchen.value;
  const start = playLayout.value ?? originalLayout.value;
  const cal = calibration.value;
  const econ = economics.value;
  if (!k || !start || !cal || !cal.ok || !econ) {
    optimizeState.value = { kind: "failed", reason: firstRunProblem.value ?? (cal && !cal.ok ? cal.message : "The model has nothing to learn from yet.") };
    return;
  }
  const gen = optimizeSteps({ scan: k.scan, setup: k.setup, start, area: dragArea({ scan: k.scan, setup: k.setup }), calibration: cal.value, economics: econ });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;
  cancelJob = () => {
    cancelled = true;
    if (timer !== undefined) clearTimeout(timer);
  };
  optimizeState.value = { kind: "running", fraction: 0 };

  const tick = () => {
    if (cancelled) return;
    const until = performance.now() + SLICE_MS;
    let r = gen.next();
    while (!r.done && performance.now() < until) r = gen.next();
    if (!r.done) {
      optimizeState.value = { kind: "running", fraction: r.value.fraction };
      timer = setTimeout(tick, 0);
      return;
    }
    cancelJob = null;
    // The judge changed the kitchen (or left Setup) while it searched: their change wins.
    if (view.value !== "play" || kitchen.value !== k || (playLayout.value ?? originalLayout.value) !== start) {
      optimizeState.value = { kind: "idle" };
      return;
    }
    const result = r.value;
    if (!result.ok) {
      optimizeState.value = { kind: "failed", reason: result.reason };
      return;
    }
    const stage = (layout: Layout): ProfitEstimate | null => {
      try {
        return profitOf(resolveWorld(k.scan, k.setup, layout), cal.value, econ);
      } catch {
        return null;
      }
    };
    const profitBefore = stage(start);
    optimizeState.value = { kind: "done", plan: { result, start, profitBefore, profitAfter: result.changed ? stage(result.layout) : profitBefore } };
  };
  timer = setTimeout(tick, 0);
}
