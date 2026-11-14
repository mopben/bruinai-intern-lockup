/**
 * Changing which kitchen is on stage: the recorded one, a live scan, or the
 * owner's corrections. Each change resets what depended on the old kitchen.
 */
import { batch } from "@preact/signals";
import type { Scan } from "../../core";
import type { Kitchen } from "../app/kitchen-edit";
import { buildStarterKitchen } from "../app/starter-setup";
import { withDemoRecipes } from "../app/recipes";
import { withScene } from "./scene-ref";
import {
  base,
  frozen,
  kitchen,
  kitchenOrigin,
  latestLiveScan,
  moveInScan,
  outcome,
  outcomeProblem,
  playLayout,
  scanNotes,
  scanState,
  secondRun,
  selectedId,
  view,
  testPlan,
} from "./store";

let revealToken = 0;

function resetDownstream(): void {
  frozen.value = null;
  testPlan.value = null;
  secondRun.value = null;
  outcome.value = null;
  outcomeProblem.value = null;
}

/** Boxes rise with the scanner's labels, then the owner's names fade in. */
export function reveal(): void {
  const k = kitchen.value;
  if (!k) return;
  const token = ++revealToken;
  scanState.value = "revealing";
  withScene(async (scene) => {
    scene.setKitchen({ scan: k.scan, setup: k.setup, layout: k.layout });
    await scene.playReveal();
    if (token !== revealToken) return;
    await scene.showNames();
    if (token === revealToken) scanState.value = "ready";
  });
}

/** Shows names at once (no animation), e.g. when the operator skips ahead. */
export function settleReveal(): void {
  if (scanState.value !== "revealing") return;
  revealToken += 1;
  scanState.value = "ready";
  withScene((scene) => void scene.showNames());
}

export function useRecordedKitchen(animate: boolean): void {
  const b = base.value;
  if (!b) return;
  batch(() => {
    kitchen.value = { scan: b.scan, setup: withDemoRecipes(b.setup), layout: b.layout };
    kitchenOrigin.value = "recorded";
    playLayout.value = b.layout;
    scanNotes.value = [];
    moveInScan.value = false;
    selectedId.value = null;
    resetDownstream();
  });
  if (animate) {
    reveal();
    return;
  }
  revealToken += 1;
  scanState.value = "ready";
  withScene((scene) => {
    scene.setKitchen({ scan: b.scan, setup: b.setup, layout: b.layout });
    void scene.showNames();
  });
}

/** A scan from the phone or a dropped file: build a starter setup and reveal it. */
export function acceptLiveScan(scan: Scan): void {
  const starter = buildStarterKitchen(scan);
  batch(() => {
    latestLiveScan.value = scan;
    kitchen.value = { scan, setup: starter.setup, layout: starter.layout };
    kitchenOrigin.value = "live";
    playLayout.value = starter.layout;
    scanNotes.value = starter.notes;
    moveInScan.value = true;
    selectedId.value = null;
    view.value = "scan";
    resetDownstream();
  });
  reveal();
}

/** Waiting for the phone: no kitchen until a scan arrives. */
export function waitForLiveScan(): void {
  const latest = latestLiveScan.value;
  if (latest) {
    acceptLiveScan(latest);
    return;
  }
  batch(() => {
    kitchen.value = null;
    kitchenOrigin.value = "live";
    playLayout.value = null;
    scanState.value = "waiting";
    selectedId.value = null;
    resetDownstream();
  });
}

/** Applies an owner's correction, keeping the judge's own moves in playLayout where they still fit. */
export function editKitchen(change: (k: Kitchen) => Kitchen): void {
  const k = kitchen.value;
  if (!k) return;
  const next = change(k);
  if (next === k) return;
  batch(() => {
    kitchen.value = next;
    if (next.layout !== k.layout) {
      const judge = playLayout.value;
      playLayout.value = judge && judge !== k.layout ? change({ ...k, layout: judge }).layout : next.layout;
    }
    if (next.setup !== k.setup || next.layout !== k.layout) resetDownstream();
  });
}
