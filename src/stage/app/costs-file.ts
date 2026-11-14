/**
 * The prices-and-costs file: the owner's numbers from the C drawer, exported
 * as JSON so they can move to another laptop or browser, or be kept beside a
 * run folder. Pure: no DOM, no storage.
 *
 * Menu prices are keyed by menu item id and also carry the item's name, so a
 * file made for one kitchen still lands on another kitchen whose menu has the
 * same names but different ids. Worker wages and station work times are keyed
 * by id only.
 */
import { z } from "zod";
import type { Economics, MenuPrice, Setup } from "../../core";

export const COSTS_FORMAT = "dryrun.costs" as const;

export interface CostsFile {
  readonly format: typeof COSTS_FORMAT;
  readonly version: 1;
  readonly savedAt: string;
  readonly currency: string;
  readonly menu: Readonly<Record<string, MenuPrice & { readonly name?: string }>>;
  readonly wagePerHour: number;
  readonly wageByWorker: Readonly<Record<string, number>>;
  readonly electricityPerHour: number;
  readonly otherPerHour: number;
  readonly demandPerHour: number;
  /** Real work time per order at each station, seconds, keyed by station id. Optional in files made before it existed. */
  readonly workS: Readonly<Record<string, number>>;
}

const money = z.number().refine(Number.isFinite, "must be a number").min(0, "must not be negative");
const costsFileSchema = z.object({
  format: z.literal(COSTS_FORMAT),
  version: z.literal(1),
  savedAt: z.string().optional(),
  currency: z.string().max(4, "must be at most 4 characters"),
  menu: z.record(z.string(), z.object({ name: z.string().optional(), price: money, ingredients: money })),
  wagePerHour: money,
  wageByWorker: z.record(z.string(), money).optional(),
  electricityPerHour: money,
  otherPerHour: money,
  demandPerHour: money,
  workS: z.record(z.string(), z.number().refine(Number.isFinite, "must be a number").positive("must be more than 0")).optional(),
});

/** The numbers in use, as a file. Menu entries carry the item's name from the setup. */
export function costsFileOf(econ: Economics, setup: Setup, savedAt = new Date()): CostsFile {
  const menu: Record<string, MenuPrice & { name?: string }> = {};
  for (const [id, p] of Object.entries(econ.menu)) {
    const name = setup.menu.find((m) => m.id === id)?.name;
    menu[id] = name === undefined ? { price: p.price, ingredients: p.ingredients } : { name, price: p.price, ingredients: p.ingredients };
  }
  return {
    format: COSTS_FORMAT,
    version: 1,
    savedAt: savedAt.toISOString(),
    currency: econ.currency,
    menu,
    wagePerHour: econ.wagePerHour,
    wageByWorker: { ...(econ.wageByWorker ?? {}) },
    electricityPerHour: econ.electricityPerHour,
    otherPerHour: econ.otherPerHour,
    demandPerHour: econ.demandPerHour,
    workS: { ...(econ.workS ?? {}) },
  };
}

export const serialiseCosts = (c: CostsFile): string => `${JSON.stringify(c, null, 2)}\n`;

export type ParsedCosts = { readonly ok: true; readonly value: CostsFile } | { readonly ok: false; readonly error: string };

export function parseCosts(text: string): ParsedCosts {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file is not JSON. Choose a prices-and-costs file exported from this page." };
  }
  const parsed = costsFileSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: `That is not a prices-and-costs file (${first ? `${first.path.join(".") || "file"}: ${first.message}` : "unknown problem"}).` };
  }
  const d = parsed.data;
  return {
    ok: true,
    value: {
      format: COSTS_FORMAT,
      version: 1,
      savedAt: d.savedAt ?? "",
      currency: d.currency.trim() || "$",
      menu: d.menu,
      wagePerHour: d.wagePerHour,
      wageByWorker: d.wageByWorker ?? {},
      electricityPerHour: d.electricityPerHour,
      otherPerHour: d.otherPerHour,
      demandPerHour: Math.round(d.demandPerHour),
      workS: d.workS ?? {},
    },
  };
}

export interface AppliedCosts {
  /** The owner's numbers to store; menu items the file does not cover are left out, so they keep their example prices. */
  readonly economics: Partial<Economics>;
  /** Menu items of this kitchen that got a price from the file. */
  readonly matched: number;
  /** Menu items of this kitchen the file had no price for. */
  readonly missing: readonly string[];
}

/** Fits a file to this kitchen's menu: by item id first, then by name (ignoring case). */
export function applyCosts(file: CostsFile, setup: Setup): AppliedCosts {
  const byName = new Map<string, MenuPrice>();
  for (const p of Object.values(file.menu)) if (p.name) byName.set(p.name.trim().toLowerCase(), p);
  const menu: Record<string, MenuPrice> = {};
  const missing: string[] = [];
  for (const m of setup.menu) {
    const p = file.menu[m.id] ?? byName.get(m.name.trim().toLowerCase());
    if (p) menu[m.id] = { price: p.price, ingredients: p.ingredients };
    else missing.push(m.name);
  }
  return {
    economics: {
      currency: file.currency,
      menu,
      wagePerHour: file.wagePerHour,
      wageByWorker: { ...file.wageByWorker },
      electricityPerHour: file.electricityPerHour,
      otherPerHour: file.otherPerHour,
      demandPerHour: file.demandPerHour,
      workS: { ...file.workS },
    },
    matched: setup.menu.length - missing.length,
    missing,
  };
}
