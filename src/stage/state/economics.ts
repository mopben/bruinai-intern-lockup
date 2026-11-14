/**
 * The owner's prices and costs (key C), and profit per hour for the layout on
 * screen. Kept in this browser (localStorage) so they survive a reload; they
 * are not part of a run folder.
 */
import { computed, signal } from "@preact/signals";
import { exampleEconomics, profitOf, resolveWorld, type Economics, type MenuPrice, type ProfitEstimate } from "../../core";
import type { Computed } from "../app/numbers";
import { explainError } from "../app/numbers";
import { calibration, originalLayout } from "./derive";
import { kitchen, playLayout } from "./store";

const STORAGE_KEY = "dryrun.economics.v1";

function load(): Partial<Economics> | null {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<Economics>) : null;
  } catch {
    return null;
  }
}

function save(e: Partial<Economics> | null): void {
  try {
    if (e === null) globalThis.localStorage?.removeItem(STORAGE_KEY);
    else globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(e));
  } catch {
    // Private window or blocked storage: the numbers still work until reload.
  }
}

/** What the owner has typed in. Null until they change anything: the example numbers are used. */
export const storedEconomics = signal<Partial<Economics> | null>(load());
export const costsOpen = signal(false);
export const workersOpen = signal(false);

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/** The numbers in use: the owner's where given, the examples for everything else (including new menu items). */
export const economics = computed<Economics | null>(() => {
  const k = kitchen.value;
  if (!k) return null;
  const ex = exampleEconomics(k.setup);
  const s = storedEconomics.value;
  if (!s) return ex;
  const menu: Record<string, MenuPrice> = {};
  for (const id of Object.keys(ex.menu)) {
    const given = s.menu?.[id];
    const base = ex.menu[id] as MenuPrice;
    menu[id] = { price: num(given?.price, base.price), ingredients: num(given?.ingredients, base.ingredients) };
  }
  return {
    currency: typeof s.currency === "string" && s.currency.length <= 4 ? s.currency : ex.currency,
    menu,
    wagePerHour: num(s.wagePerHour, ex.wagePerHour),
    workerWages: Object.fromEntries(Object.entries(s.workerWages ?? {}).filter(([, v]) => typeof v === "number" && Number.isFinite(v) && v >= 0)),
    electricityPerHour: num(s.electricityPerHour, ex.electricityPerHour),
    otherPerHour: num(s.otherPerHour, ex.otherPerHour),
    demandPerHour: num(s.demandPerHour, ex.demandPerHour),
  };
});

/** True while every number is still an example. */
export const economicsAreExamples = computed(() => storedEconomics.value === null);

/** Changes some of the numbers. Anything that depends on them (the optimizer's answer) is told by the caller. */
export function setEconomics(change: Partial<Economics>): void {
  const cur = economics.value;
  if (!cur) return;
  const next: Partial<Economics> = { ...cur, ...change, menu: { ...cur.menu, ...(change.menu ?? {}) } };
  storedEconomics.value = next;
  save(next);
}

export function useExampleEconomics(): void {
  storedEconomics.value = null;
  save(null);
}

function profitFor(layout: ReturnType<typeof originalLayout.peek>): Computed<ProfitEstimate> | null {
  const k = kitchen.value;
  const econ = economics.value;
  const c = calibration.value;
  if (!k || !econ || !layout) return null;
  if (!c) return { ok: false, message: "Run the kitchen once to measure how long each step takes." };
  if (!c.ok) return c;
  try {
    return { ok: true, value: profitOf(resolveWorld(k.scan, k.setup, layout), c.value, econ) };
  } catch (error) {
    return { ok: false, message: explainError(error) };
  }
}

/** Profit per hour of the layout the first run was made in. */
export const baselineProfit = computed(() => profitFor(originalLayout.value));

/** Profit per hour of the judge's layout, recomputed on every drag move. */
export const playProfit = computed(() => profitFor(playLayout.value ?? originalLayout.value));

/** Update one worker without changing anyone else's pay. */
export function setWorkerSalary(workerId: string, salary: number): void {
  const cur = economics.value;
  if (!cur || !Number.isFinite(salary) || salary < 0) return;
  setEconomics({ workerWages: { ...cur.workerWages, [workerId]: salary } });
}
