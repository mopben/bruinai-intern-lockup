/**
 * TEST HOOK. `window.__dryrun` lets the acceptance test (e2e/) read what the
 * stage holds: the step, the session, and each scene's snapshot (tickets per
 * station, alerts, item positions on screen, frames drawn). Read-only: it
 * changes nothing and nothing on screen reads it.
 */
import type { SceneDebug } from "../scene";
import { mainScene, namedScenes } from "./scene-ref";
import { checkOpen, firstRun, frozen, outcome, playLayout, session, sources, step, testPlan } from "./store";

export interface DryRunTestHook {
  readonly step: () => string;
  /** True while Test shows the real-run check, false while it shows the simulation. */
  readonly checkOpen: () => boolean;
  readonly session: () => unknown;
  readonly sources: () => unknown;
  readonly frozenJudge: () => unknown;
  readonly frozen: () => unknown;
  readonly testPlan: () => unknown;
  readonly outcome: () => unknown;
  readonly firstRun: () => unknown;
  readonly playLayout: () => unknown;
  readonly main: () => SceneDebug | null;
  readonly scene: (name: string) => SceneDebug | null;
  readonly sceneNames: () => readonly string[];
}

export function installTestHook(): void {
  const hook: DryRunTestHook = Object.freeze({
    step: () => step.value,
    checkOpen: () => checkOpen.value,
    session: () => session.value,
    sources: () => sources.value,
    frozenJudge: () => frozen.value?.judge.prediction?.meanOrderTime ?? null,
    frozen: () => {
      const f = frozen.value;
      if (!f) return null;
      const range = (e: { prediction: { meanOrderTime: unknown } | null } | undefined) => e?.prediction?.meanOrderTime ?? null;
      return { basis: f.basis, judge: range(f.judge), candidates: Object.fromEntries(Object.entries(f.candidates).map(([k, e]) => [k, range(e)])) };
    },
    testPlan: () => {
      const p = testPlan.value;
      return p ? { matched: p.matched, live: p.live, candidateId: p.candidate?.id ?? null, workers: p.layout.workers.length, judgeWorkers: p.judgeLayout.workers.length, stale: p.judgeLayout !== playLayout.value } : null;
    },
    outcome: () => (outcome.value ? { measuredS: outcome.value.measuredS, inside: outcome.value.check.inside, predicted: outcome.value.predicted } : null),
    firstRun: () => {
      const r = firstRun.value;
      return r ? { label: r.label, origin: r.origin, replaced: r.replaced, savedId: r.savedId ?? null, taps: r.taps.length, positions: r.positions.length } : null;
    },
    playLayout: () => playLayout.value,
    main: () => mainScene()?.debug() ?? null,
    scene: (name: string) => namedScenes().get(name)?.debug() ?? null,
    sceneNames: () => [...namedScenes().keys()],
  });
  Object.defineProperty(globalThis, "__dryrun", { value: hook, configurable: true });
}
