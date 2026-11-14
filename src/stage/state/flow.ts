/**
 * Moving through the views, and what each does on arrival and on
 * leaving. The prediction is frozen from the first run only.
 */
import { batch } from "@preact/signals";
import { reconstructRun, type RunBundle } from "../../core";
import { loadRunBundle } from "../../inputs";
import { freezePredictions } from "../app/frozen";
import { runFitsKitchen } from "../app/kitchen-edit";
import { changeKind, layoutsMatch, matchRecordedRun, type Candidate } from "../app/layout-match";
import { stepIndex, stepOf, type ViewId } from "../app/steps";
import { runStory, testOutcome } from "../app/words";
import { cancelSuggest } from "./suggest";
import { calibration, firstMeasuredS, originalLayout, usableFirstRun } from "./derive";
import { settleReveal } from "./kitchen-actions";
import { preloadedBundle } from "./preload";
import { beginRun, currentPlayer, nextRunIsLive, startLive } from "./runs";
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
  view,
  storyText,
  testPlan,
  type MeasuredRun,
  type TestPlan,
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
      batch(() => {
        firstRun.value = run;
        storyText.value = runStory(reconstructRun(run.kitchen.setup, run.taps), nameOf).sentence;
      });
    },
    // A second run made later is linked to the saved first run, so it is listed under it.
    onSaved: (id) => {
      const run = firstRun.value;
      if (run && run.origin === "live" && !run.savedId) firstRun.value = { ...run, savedId: id };
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
    if (run.replaced.length > 0) {
      // A failover mixed a recording into the room's run: comparing it with the prediction would be no test at all.
      outcome.value = null;
      outcomeProblem.value = `Part of this run came from a recording (${run.replaced.join(" and ")}), so it is not a real test of the prediction. Run it again with the tablet and camera connected.`;
      return;
    }
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
  freezeNow();
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
    outcomeProblem.value = "No recorded second run exists for this kitchen. Switch taps and positions to live in Inputs in Import (step 1) to run the change for real.";
    return;
  }
  const layout = live || !pick || pick.matched ? f.judge.layout : pick.candidate.layout;
  const plan0: TestPlan = { candidate: pick?.candidate ?? null, matched: live || (pick?.matched ?? false), live, layout, judgeLayout: f.judge.layout, bundle: null, loadError: null };
  testPlan.value = plan0;
  // The base run is never a standby for a second run: a failover would play the "before" run as the "after".
  let bundle: RunBundle | null = null;
  if (pick) {
    const ready = preloadedBundle(pick.candidate.id);
    try {
      bundle = ready ?? (await loadRunBundle(pick.candidate.url ?? `/fixtures/${encodeURIComponent(pick.candidate.id)}/`));
    } catch (error) {
      testPlan.value = { ...plan0, loadError: error instanceof Error ? error.message : String(error) };
      if (!live) return;
    }
  }
  // Only a recording of the very layout being tested may stand in for the live inputs.
  const standbyAllowed = bundle !== null && (pick?.matched ?? false);
  bundle ??= live ? base.value : null;
  if (!bundle || view.value !== "test") return;
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
    baseRunId: firstRunId(),
    standbyAllowed: !live || standbyAllowed,
    onEnd: (run) => finishTest(run, run.origin === "live" ? k.setup : standby.setup),
  });
}

/** The id a second run is saved under as its base: the saved live first run, or the recorded one. */
function firstRunId(): string | undefined {
  const run = firstRun.value;
  if (!run) return undefined;
  return run.origin === "live" ? run.savedId : run.label;
}

/** Sets the judge's layout to a recorded run's layout exactly ("m": moved things, "w": added people). */
export function applyRehearsed(key: "m" | "w"): void {
  const k = kitchen.value;
  const original = originalLayout.value;
  if (!k || !original) return;
  cancelSuggest();
  const want = key === "m" ? "move" : "staff";
  const c = candidates.value.find((x) => changeKind(k.scan, k.setup, original, x.layout) === want);
  if (c) playLayout.value = c.layout;
}

export function resetPlay(): void {
  cancelSuggest();
  const original = originalLayout.value;
  if (original) playLayout.value = original;
}

/** Everything that happens when the step changes. */
export function goTo(next: ViewId): void {
  const prev = view.value;
  if (next === prev) return;
  if (prev === "scan") settleReveal();
  if (prev === "play") {
    cancelSuggest();
    freezeNow();
  }
  if (prev === "orders") freezeNow();
  batch(() => {
    view.value = next;
    selectedId.value = null;
  });
  rememberStep(next);
  enterStep(next);
}

/** Keeps ?step= in the address, so a reload (or a crashed tab reopened) comes back to the same step. */
function rememberStep(next: ViewId): void {
  try {
    const url = new URL(globalThis.location.href);
    const step = stepOf(next);
    url.searchParams.set("step", String(stepIndex(step) + 1));
    if (step === "results") url.searchParams.set("view", next);
    else url.searchParams.delete("view");
    globalThis.history.replaceState(globalThis.history.state, "", url);
  } catch {
    // No history API (tests in node): nothing to remember.
  }
}

/** What a step does on arrival (also used when the page opens on a step). */
export function enterStep(next: ViewId): void {
  if (next === "run") {
    const s = session.value;
    if (!s || s.purpose !== "first") beginFirstRun();
    else currentPlayer()?.redraw();
  }
  if (next === "test") void beginTest();
  if (next === "play" && !playLayout.value) playLayout.value = originalLayout.value;
}

/**
 * P in Run or Test, and the Start / Play again buttons. Follows the inputs as
 * they are now: a prepared live run starts only if the inputs are still live;
 * otherwise the run is prepared (or played) again from the current sources.
 */
export function startOrReplay(purpose: "first" | "second"): void {
  const s = session.value;
  if (s && s.purpose === purpose && s.status === "idle" && !s.replay && nextRunIsLive()) {
    startLive();
    return;
  }
  if (purpose === "first") beginFirstRun();
  else void beginTest();
}

/** After an input switch: a run that is prepared but not started is prepared again from the new sources. */
export function reprepareIdleRun(): void {
  const s = session.value;
  if (!s || s.status !== "idle") return;
  if (s.purpose === "first" && view.value === "run") beginFirstRun();
  if (s.purpose === "second" && view.value === "test") void beginTest();
}
