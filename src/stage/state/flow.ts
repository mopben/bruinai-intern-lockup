/**
 * Moving through the six steps, and what each step does on arrival and on
 * leaving. The prediction is frozen on leaving Play, from the first run only.
 */
import { batch } from "@preact/signals";
import { reconstructRun, type RunBundle } from "../../core";
import { loadRunBundle } from "../../inputs";
import { freezePredictions } from "../app/frozen";
import { runFitsKitchen } from "../app/kitchen-edit";
import { changeKind, layoutsMatch, matchRecordedRun, type Candidate } from "../app/layout-match";
import type { StepId } from "../app/steps";
import { runStory, testOutcome } from "../app/words";
import { calibration, firstMeasuredS, originalLayout, usableFirstRun } from "./derive";
import { settleReveal } from "./kitchen-actions";
import { beginRun, currentPlayer, nextRunIsLive } from "./runs";
import {
  base,
  candidates,
  firstRun,
  frozen,
  kitchen,
  outcome,
  outcomeProblem,
  playLayout,
  secondChoice,
  secondRun,
  selectedId,
  session,
  step,
  storyText,
  testPlan,
  type MeasuredRun,
} from "./store";

/** Freezes the prediction for the judge's layout (and every recorded layout) from the first run. */
export function freezeNow(): void {
  const k = kitchen.value;
  const cal = calibration.value;
  const run = usableFirstRun.value;
  const judge = playLayout.value;
  if (!k || !cal || !cal.ok || !run || !judge) {
    frozen.value = null;
    return;
  }
  frozen.value = freezePredictions({
    basis: run.label,
    scan: k.scan,
    setup: k.setup,
    calibration: cal.value,
    judgeLayout: judge,
    candidateLayouts: candidates.value.map((c) => ({ id: c.id, layout: c.layout })),
  });
}

function nameOf(id: string): string {
  return kitchen.value?.setup.items.find((i) => i.boxId === id)?.name ?? id;
}

export function beginFirstRun(): void {
  const k = kitchen.value;
  const b = base.value;
  if (!k || !b) return;
  storyText.value = null;
  if (!nextRunIsLive() && !runFitsKitchen(b, k)) {
    session.value = null;
    return;
  }
  beginRun({
    purpose: "first",
    recording: b,
    kitchen: k,
    label: "Live run",
    onEnd: (run: MeasuredRun) => {
      const now = kitchen.value ?? k;
      batch(() => {
        firstRun.value = run.origin === "live" ? run : { ...run, kitchen: { ...now, layout: run.kitchen.layout } };
        storyText.value = runStory(reconstructRun(now.setup, run.taps), nameOf).sentence;
      });
    },
  });
}

function pickCandidate(): { readonly candidate: Candidate; readonly matched: boolean } | null {
  const k = kitchen.value;
  const f = frozen.value;
  if (!k || !f) return null;
  const list = candidates.value;
  const forced = list.find((c) => c.id === secondChoice.value);
  if (forced) return { candidate: forced, matched: layoutsMatch(k.scan, k.setup, f.judge.layout, forced.layout) };
  const m = matchRecordedRun(k.scan, k.setup, f.judge.layout, list);
  return m.kind === "none" ? null : { candidate: m.candidate, matched: m.kind === "match" };
}

function finishTest(run: MeasuredRun, setupFrom: RunBundle["setup"]): void {
  const f = frozen.value;
  const plan = testPlan.value;
  if (!f || !plan) return;
  const entry = plan.matched || !plan.candidate ? f.judge : f.candidates[plan.candidate.id];
  batch(() => {
    secondRun.value = run;
    if (!entry || !entry.prediction) {
      outcome.value = null;
      outcomeProblem.value = entry?.message ?? "There was no prediction for this layout.";
      return;
    }
    const result = testOutcome(entry.prediction.meanOrderTime, reconstructRun(setupFrom, run.taps), firstMeasuredS.value);
    outcome.value = result;
    outcomeProblem.value = result ? null : "No order was finished in the second run, so there is nothing to compare.";
  });
}

/** Chooses the second run, loads it and plays it (recorded) or gets the live run ready. */
export async function beginTest(): Promise<void> {
  const k = kitchen.value;
  if (!frozen.value) freezeNow();
  const f = frozen.value;
  batch(() => {
    outcome.value = null;
    outcomeProblem.value = null;
    secondRun.value = null;
  });
  if (!k || !f) {
    testPlan.value = null;
    session.value = null;
    return;
  }
  const live = nextRunIsLive();
  const pick = pickCandidate();
  if (!pick && !live) {
    testPlan.value = null;
    outcomeProblem.value = "No recorded second run exists for this kitchen. Switch taps and positions to live (press I) to run the change for real.";
    return;
  }
  const layout = live || !pick || pick.matched ? f.judge.layout : pick.candidate.layout;
  testPlan.value = { candidate: pick?.candidate ?? null, matched: live || (pick?.matched ?? false), live, layout, bundle: null, loadError: null };
  let bundle: RunBundle | null = live && !pick ? base.value : null;
  if (pick) {
    try {
      bundle = await loadRunBundle(pick.candidate.url ?? `/fixtures/${encodeURIComponent(pick.candidate.id)}/`);
    } catch (error) {
      testPlan.value = { ...testPlan.value, loadError: error instanceof Error ? error.message : String(error) };
      if (!live) return;
      bundle = base.value;
    }
  }
  if (!bundle || step.value !== "test") return;
  const plan = testPlan.value;
  if (!plan) return;
  testPlan.value = { ...plan, bundle };
  const standby = bundle;
  beginRun({
    purpose: "second",
    recording: standby,
    kitchen: { ...k, layout },
    label: "Live run after the change",
    change: pick?.matched ? pick.candidate.meta.change ?? pick.candidate.meta.title : "The judge's change",
    baseRunId: firstRun.value?.label,
    onEnd: (run) => finishTest(run, run.origin === "live" ? k.setup : standby.setup),
  });
}

/** Sets the judge's layout to a recorded run's layout exactly ("m": moved things, "w": added people). */
export function applyRehearsed(key: "m" | "w"): void {
  const k = kitchen.value;
  const original = originalLayout.value;
  if (!k || !original) return;
  const want = key === "m" ? "move" : "staff";
  const c = candidates.value.find((x) => changeKind(k.scan, k.setup, original, x.layout) === want);
  if (c) playLayout.value = c.layout;
}

export function resetPlay(): void {
  const original = originalLayout.value;
  if (original) playLayout.value = original;
}

/** Everything that happens when the step changes. */
export function goTo(next: StepId): void {
  const prev = step.value;
  if (next === prev) return;
  if (prev === "scan") settleReveal();
  if (prev === "play") freezeNow();
  batch(() => {
    step.value = next;
    selectedId.value = null;
  });
  enterStep(next);
}

/** What a step does on arrival (also used when the page opens on a step). */
export function enterStep(next: StepId): void {
  if (next === "run") {
    const s = session.value;
    if (!s || s.purpose !== "first") beginFirstRun();
    else currentPlayer()?.redraw();
  }
  if (next === "test") void beginTest();
  if (next === "play" && !playLayout.value) playLayout.value = originalLayout.value;
}
