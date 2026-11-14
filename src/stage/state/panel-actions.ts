/**
 * The side panel: open or closed, its width, and what a click or a key on a
 * step does. Saved to localStorage so a reload brings back the same panel.
 */
import { effect } from "@preact/signals";
import { PANEL_KEY, clampWidth, defaultPanelWidth, dragResult, parsePanel } from "../app/panel";
import { defaultView, type StepId } from "../app/steps";
import { goTo } from "./flow";
import { currentStep, panel } from "./store";

const vw = () => globalThis.innerWidth || 1024;

/** Read once at boot, then kept in localStorage on every change. */
export function loadPanel(): void {
  let saved: string | null = null;
  try {
    saved = globalThis.localStorage?.getItem(PANEL_KEY) ?? null;
  } catch {
    saved = null;
  }
  panel.value = parsePanel(saved, vw());
  // A window that changes size keeps the panel's share of it, like VS Code.
  let lastVw = vw();
  globalThis.addEventListener?.("resize", () => {
    const now = vw();
    if (now === lastVw) return;
    panel.value = { ...panel.value, width: clampWidth(panel.value.width * (now / lastVw), now) };
    lastVw = now;
  });
  effect(() => {
    const p = panel.value;
    try {
      globalThis.localStorage?.setItem(PANEL_KEY, JSON.stringify(p));
    } catch {
      // Private mode or a full store: the panel just is not remembered.
    }
  });
}

/** VS Code semantics: another step goes there and opens; the current step toggles. */
export function activate(step: StepId): void {
  if (step === currentStep.value) {
    panel.value = { ...panel.value, open: !panel.value.open };
    return;
  }
  goTo(defaultView(step));
  openPanel();
}

export function openPanel(): void {
  if (!panel.value.open) panel.value = { ...panel.value, open: true };
}

export function setPanelWidth(px: number): void {
  panel.value = { open: true, width: clampWidth(px, vw()) };
}

let dragStart: number | null = null;
export function beginDrag(): void {
  dragStart = panel.value.width;
}

/** px is the width the drag ended at; below the snap the panel closes and keeps the width it had. */
export function endDrag(px: number): void {
  panel.value = dragResult(px, dragStart ?? panel.value.width, vw());
  dragStart = null;
}

export function resetPanelWidth(): void {
  panel.value = { open: true, width: defaultPanelWidth(vw()) };
}
