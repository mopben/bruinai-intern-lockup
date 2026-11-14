import { batch, effect, signal } from "@preact/signals";
import { z } from "zod";
import { layoutSchema, scanSchema, setupSchema, runBundleSchema, runMetaSchema, tapEventSchema, positionSampleSchema } from "../../inputs";
import type { Economics, RunBundle } from "../../core";
import type { Kitchen } from "../app/kitchen-edit";
import type { Candidate } from "../app/layout-match";
import { kitchenForShift, shiftOrders, type ShiftOrders } from "../app/scenarios";
import { withDemoRecipes } from "../app/recipes";
import { calibration } from "./derive";
import { storedEconomics, workersOpen, costsOpen } from "./economics";
import { stopAllPlayback } from "./runs";
import { cancelOptimize } from "./optimize";
import { enterStep } from "./flow";
import {
  activeSetupId, activeShiftId, addNotice, base, candidates, firstRun, frozen,
  importOpen, kitchen, kitchenOrigin, orderCount, outcome, outcomeProblem, playLayout,
  scanNotes, scanState, secondRun, selectedId, sources, storyText, testPlan, view, workspaceReady,
  type MeasuredRun,
} from "./store";

export interface SavedSetup {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly kitchen: Kitchen;
  readonly measured: MeasuredRun | null;
  readonly recording: RunBundle | null;
  readonly economics: Partial<Economics> | null;
  readonly origin: "recorded" | "live";
  readonly candidates: readonly Candidate[];
}
export interface SavedShift extends ShiftOrders {
  readonly id: string;
  readonly name: string;
}
export interface ScenarioChoice { readonly setupId: string; readonly shiftId: string }
export const savedSetups = signal<readonly SavedSetup[]>([]);
export const savedShifts = signal<readonly SavedShift[]>([]);
export const scenarioChoices = signal<readonly ScenarioChoice[]>([
  { setupId: "", shiftId: "" }, { setupId: "", shiftId: "" },
]);
export const workspaceProblem = signal<string | null>(null);
const STORAGE_KEY = "dryrun.workspace.v1";
const kitchenSchema = z.object({ scan: scanSchema, setup: setupSchema, layout: layoutSchema });
const measuredSchema = z.object({
  label: z.string(), kitchen: kitchenSchema, taps: z.array(tapEventSchema), positions: z.array(positionSampleSchema),
  origin: z.enum(["recorded", "live"]), replaced: z.array(z.string()), title: z.string().optional(), savedId: z.string().optional(),
});
const workspaceSchema = z.object({
  version: z.literal(1), activeSetupId: z.string().nullable(), activeShiftId: z.string().nullable(),
  setups: z.array(z.object({
    id: z.string(), name: z.string(), type: z.string(), kitchen: kitchenSchema,
    measured: measuredSchema.nullable(), recording: runBundleSchema.nullable(), origin: z.enum(["recorded", "live"]),
    candidates: z.array(z.object({ id: z.string(), meta: runMetaSchema, layout: layoutSchema, url: z.string().optional() })).default([]),
    economics: z.object({}).passthrough().nullable(),
  })),
  shifts: z.array(z.object({ id: z.string(), name: z.string(), menu: setupSchema.shape.menu, schedule: setupSchema.shape.schedule, items: setupSchema.shape.items })),
  choices: z.array(z.object({ setupId: z.string(), shiftId: z.string() })).length(2),
});

export function resetScenarioState(): void {
  stopAllPlayback();
  cancelOptimize();
  batch(() => {
    frozen.value = null; testPlan.value = null; secondRun.value = null;
    outcome.value = null; outcomeProblem.value = null; selectedId.value = null;
    storyText.value = null; orderCount.value = null;
    workersOpen.value = false; costsOpen.value = false; importOpen.value = false;
  });
}

function putSetup(saved: SavedSetup): void {
  savedSetups.value = savedSetups.peek().map((entry) => entry.id === saved.id ? saved : entry);
}

function snapshotSetup(): void {
  const id = activeSetupId.peek();
  const k = kitchen.peek();
  const saved = savedSetups.peek().find((entry) => entry.id === id);
  if (!saved || !k) return;
  const layout = playLayout.peek() ?? k.layout;
  if (saved.kitchen === k && layout === k.layout && saved.measured === firstRun.peek() && saved.recording === base.peek() && saved.economics === storedEconomics.peek() && saved.candidates === candidates.peek()) return;
  putSetup({ ...saved, kitchen: layout === k.layout ? k : { ...k, layout }, measured: firstRun.peek(), recording: base.peek(), economics: storedEconomics.peek(), origin: kitchenOrigin.peek(), candidates: candidates.peek() });
}

function snapshotShift(): void {
  const id = activeShiftId.peek();
  const k = kitchen.peek();
  const saved = savedShifts.peek().find((entry) => entry.id === id);
  if (!activeSetupId.peek() || !saved || !k || (saved.menu === k.setup.menu && saved.schedule === k.setup.schedule && saved.items === k.setup.items)) return;
  savedShifts.value = savedShifts.peek().map((entry) => entry.id === id ? { ...entry, menu: k.setup.menu, schedule: k.setup.schedule, items: k.setup.items } : entry);
}

export function selectSetup(id: string): void {
  const saved = savedSetups.peek().find((entry) => entry.id === id);
  if (!saved) return;
  snapshotSetup(); snapshotShift(); resetScenarioState();
  let next = saved.kitchen;
  const shift = savedShifts.peek().find((entry) => entry.id === activeShiftId.peek());
  let shiftId = shift?.id ?? null;
  if (shift) {
    try { next = kitchenForShift(next, shift); }
    catch (error) {
      shiftId = null;
      addNotice({ id: "shift-binding", text: (error as Error).message, tone: "warn" });
    }
  }
  batch(() => {
    activeSetupId.value = saved.id; activeShiftId.value = shiftId;
    kitchen.value = next; playLayout.value = next.layout;
    firstRun.value = saved.measured; base.value = saved.recording;
    candidates.value = saved.candidates; storedEconomics.value = saved.economics;
    kitchenOrigin.value = saved.origin; sources.value = { scan: saved.origin === "live" ? "live" : "replay", taps: "replay", positions: "replay" };
    scanState.value = "ready"; scanNotes.value = [];
  });
  enterStep(view.peek());
}

export function createSetup(): void {
  snapshotSetup(); snapshotShift();
  const recording = base.peek();
  const current = kitchen.peek();
  const k = current ?? (recording ? { scan: recording.scan, setup: withDemoRecipes(recording.setup), layout: recording.layout } : null);
  if (!k) { addNotice({ id: "setup", text: "The starting kitchen is still loading.", tone: "warn" }); return; }
  const id = crypto.randomUUID();
  const saved: SavedSetup = {
    id, name: `Setup ${savedSetups.peek().length + 1}`, type: "Baseline",
    kitchen: structuredClone({ ...k, layout: playLayout.peek() ?? k.layout }),
    measured: firstRun.peek(), recording, economics: storedEconomics.peek(), origin: current ? kitchenOrigin.peek() : "recorded",
    candidates: candidates.peek(),
  };
  savedSetups.value = [...savedSetups.peek(), saved];
  selectSetup(id);
}

export function renameSetup(change: Partial<Pick<SavedSetup, "name" | "type">>): void {
  const saved = savedSetups.peek().find((entry) => entry.id === activeSetupId.peek());
  if (saved) putSetup({ ...saved, ...change });
}

export function selectShift(id: string): void {
  const shift = savedShifts.peek().find((entry) => entry.id === id);
  const k = kitchen.peek();
  if (!shift || !k) return;
  let next: Kitchen;
  try { next = kitchenForShift(k, shift); }
  catch (error) { addNotice({ id: "shift-binding", text: (error as Error).message, tone: "warn" }); return; }
  snapshotShift(); resetScenarioState();
  batch(() => { activeShiftId.value = id; kitchen.value = next; });
}

export function createShift(duplicate = false): void {
  const k = kitchen.peek();
  if (!k || !activeSetupId.peek()) return;
  snapshotShift();
  const cal = calibration.peek();
  const orders = shiftOrders(k, cal?.ok ? cal.value : null);
  const shift: SavedShift = {
    ...orders, id: crypto.randomUUID(), name: `Shift ${savedShifts.peek().length + 1}`,
    schedule: duplicate ? orders.schedule : { orders: [] },
  };
  savedShifts.value = [...savedShifts.peek(), shift];
  selectShift(shift.id);
}

export function renameShift(name: string): void {
  savedShifts.value = savedShifts.peek().map((entry) => entry.id === activeShiftId.peek() ? { ...entry, name } : entry);
}

export function chooseScenario(index: number, change: Partial<ScenarioChoice>): void {
  scenarioChoices.value = scenarioChoices.peek().map((entry, i) => i === index ? { ...entry, ...change } : entry);
}

export function resolvedChoice(index: number): ScenarioChoice {
  const choice = scenarioChoices.value[index]!;
  const setups = savedSetups.value;
  const shifts = savedShifts.value;
  return {
    setupId: setups.some((s) => s.id === choice.setupId) ? choice.setupId : activeSetupId.value ?? setups[0]?.id ?? "",
    shiftId: shifts.some((s) => s.id === choice.shiftId) ? choice.shiftId : activeShiftId.value ?? shifts[0]?.id ?? "",
  };
}

export function saveWorkspace(): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify({
      version: 1, setups: savedSetups.peek(), shifts: savedShifts.peek(),
      activeSetupId: activeSetupId.peek(), activeShiftId: activeShiftId.peek(), choices: scenarioChoices.peek(),
    }));
    workspaceProblem.value = null;
  } catch { workspaceProblem.value = "Browser storage is full or unavailable. Changes are kept in this tab until it closes."; }
}

/** Install only after boot has loaded the starting kitchen. */
export function initializeWorkspace(): () => void {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (raw) {
      const data = workspaceSchema.parse(JSON.parse(raw));
      batch(() => {
        savedSetups.value = data.setups as readonly SavedSetup[];
        savedShifts.value = data.shifts;
        scenarioChoices.value = data.choices;
        activeShiftId.value = data.activeShiftId;
      });
      if (data.activeSetupId) selectSetup(data.activeSetupId);
    }
  } catch { workspaceProblem.value = "Saved setups could not be loaded. Your previous browser data has been left in place."; }
  workspaceReady.value = true;
  const offSnapshot = effect(() => {
    kitchen.value; playLayout.value; firstRun.value; base.value; candidates.value; storedEconomics.value; kitchenOrigin.value;
    snapshotSetup(); snapshotShift();
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const offSave = effect(() => {
    savedSetups.value; savedShifts.value; activeSetupId.value; activeShiftId.value; scenarioChoices.value;
    // Do not overwrite unreadable data with an empty library.
    if (!savedSetups.peek().length) return;
    clearTimeout(timer); timer = setTimeout(saveWorkspace, 200);
  });
  const flush = () => { if (savedSetups.peek().length) { snapshotSetup(); snapshotShift(); saveWorkspace(); } };
  window.addEventListener("pagehide", flush);
  return () => { offSnapshot(); offSave(); clearTimeout(timer); window.removeEventListener("pagehide", flush); };
}
