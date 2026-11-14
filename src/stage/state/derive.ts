/**
 * Numbers derived from the loaded inputs. Computed signals: they update when
 * the kitchen, the first run or the judge's layout change, never from cache.
 */
import { computed } from "@preact/signals";
import { calibrate, reconstructRun, summariseRun, trustCheck, type Calibration, type Layout, type TrustResult } from "../../core";
import { runFitsKitchen } from "../app/kitchen-edit";
import { explainError, layoutNumbers, tryWorld, type Computed, type LayoutNumbers } from "../app/numbers";
import { firstRun, kitchen, playLayout } from "./store";

const fail = (message: string) => ({ ok: false as const, message });

/** The first run, if it was made in (a correction of) the kitchen on screen. */
export const usableFirstRun = computed(() => {
  const run = firstRun.value;
  const k = kitchen.value;
  if (!run || !k) return null;
  return runFitsKitchen(run.kitchen, k) ? run : null;
});

/** Why there is no usable first run, in words. */
export const firstRunProblem = computed<string | null>(() => {
  if (!kitchen.value) return "There is no kitchen yet. Scan one, or use the recorded scan (press I).";
  if (!firstRun.value) return "This kitchen has not been run yet. Go to Run and start a run.";
  if (!usableFirstRun.value) return "The run on file was made in a different kitchen. Go to Run and run this one.";
  return null;
});

/** The layout the first run was made in: the "before". */
export const originalLayout = computed<Layout | null>(() => usableFirstRun.value?.kitchen.layout ?? kitchen.value?.layout ?? null);

const firstWorld = computed(() => {
  const run = usableFirstRun.value;
  const k = kitchen.value;
  if (!run || !k) return null;
  return tryWorld(k.scan, k.setup, run.kitchen.layout);
});

/** Learned from the whole first run (Play and the frozen prediction use this). */
export const calibration = computed<Computed<Calibration> | null>(() => {
  const run = usableFirstRun.value;
  const w = firstWorld.value;
  if (!run || !w) return null;
  if (!w.ok) return w;
  try {
    return { ok: true, value: calibrate(w.value, reconstructRun(w.value.setup, run.taps), run.positions) };
  } catch (error) {
    return fail(explainError(error));
  }
});

/** The trust check on the first run: calibrates on half the orders, checks on the rest. */
export const trust = computed<Computed<TrustResult> | null>(() => {
  const run = usableFirstRun.value;
  const w = firstWorld.value;
  if (!run || !w) return null;
  if (!w.ok) return w;
  try {
    return { ok: true, value: trustCheck(w.value, run.taps, run.positions) };
  } catch (error) {
    return fail(explainError(error));
  }
});

/** Mean order time measured in the first run, seconds. */
export const firstMeasuredS = computed<number | null>(() => {
  const run = usableFirstRun.value;
  const k = kitchen.value;
  if (!run || !k) return null;
  return summariseRun(reconstructRun(k.setup, run.taps)).meanOrderTimeS;
});

const cal = () => {
  const c = calibration.value;
  return c && c.ok ? c.value : null;
};

/** Both numbers for the layout the first run was made in. */
export const baselineNumbers = computed<LayoutNumbers | null>(() => {
  const k = kitchen.value;
  const layout = originalLayout.value;
  if (!k || !layout) return null;
  return layoutNumbers(k.scan, k.setup, layout, cal());
});

/** Both numbers for the judge's layout, recomputed on every drag move. */
export const playNumbers = computed<LayoutNumbers | null>(() => {
  const k = kitchen.value;
  const layout = playLayout.value;
  if (!k || !layout) return null;
  return layoutNumbers(k.scan, k.setup, layout, cal());
});
