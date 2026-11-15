/**
 * Profit per hour of a layout, from the owner's prices and costs.
 *
 * The question it answers: in a busy hour, what does this kitchen make after
 * paying for everything? Orders come in at `demandPerHour`. The kitchen sells
 * as many as it can make: the smaller of that demand and its capacity. Capacity
 * comes from the simulation: a long queue of orders is released at once and the
 * rate at which the kitchen finishes them (first finish to last) is how many it
 * can make in an hour. So the time to make an order, walking included, sets
 * the sales, and wages are paid for every worker whether busy or not.
 *
 *   profit per hour = sales x (price - ingredients)  (by the menu mix)
 *                   - workers x wage - electricity - other costs
 *
 * Every number is a p10/p50/p90 range over simulated runs, like the rest of the
 * model. Pure: no DOM, no I/O.
 */
import type { Calibration } from "./calibrate";
import { mixSeed } from "./rng";
import { compileEngineModel, runEngine, type Releases } from "./engine/index";
import { rangeOf, type Range } from "./stats";
import type { Setup } from "./types";
import { buildPathTable, type PathTable } from "./walking";
import type { World } from "./world";
import { walkExtrapolation } from "./extrapolation";

export interface MenuPrice {
  /** What a customer pays, per item. */
  readonly price: number;
  /** Ingredients and packaging, per item. */
  readonly ingredients: number;
}

/** The owner's money numbers. All per hour unless the name says otherwise. */
export interface Economics {
  /** Shown before amounts, e.g. "$". */
  readonly currency: string;
  /** Keyed by menu item id. A missing item counts as price 0, cost 0. */
  readonly menu: Readonly<Record<string, MenuPrice>>;
  /** Pay per worker per hour, all-in. */
  readonly wagePerHour: number;
  /** Individual hourly pay, keyed by worker id; otherwise use wagePerHour. */
  readonly workerWages?: Readonly<Record<string, number>>;
  /** Electricity for the whole kitchen per hour. */
  readonly electricityPerHour: number;
  /** Rent and everything else per hour. */
  readonly otherPerHour: number;
  /** Orders that come in during a busy hour. */
  readonly demandPerHour: number;
}

export interface ProfitEstimate {
  /** Orders an hour the kitchen can make, flat out. */
  readonly capacityPerHour: Range;
  /** Orders sold an hour: the smaller of demand and capacity. */
  readonly salesPerHour: Range;
  readonly revenuePerHour: Range;
  readonly profitPerHour: Range;
  /** Mean of price minus ingredients over the menu mix, per order. */
  readonly marginPerOrder: number;
  readonly wagesPerHour: number;
  readonly fixedPerHour: number;
  readonly workers: number;
  /** "capacity" when the kitchen cannot keep up with the orders coming in. */
  readonly limitedBy: "demand" | "capacity";
}

/** Orders queued at once to measure capacity. Long enough to get past filling the line. */
export const CAPACITY_ORDERS = 30;
export const PROFIT_REPS = 100;
export const PROFIT_SEED = 1;

/** Example numbers for a small café, to be edited. The demand is the rate of the recorded run's orders. */
export function exampleEconomics(setup: Setup): Economics {
  const menu: Record<string, MenuPrice> = {};
  for (const m of setup.menu) menu[m.id] = { price: 4.5, ingredients: 1.2 };
  return { currency: "$", menu, wagePerHour: 18, electricityPerHour: 1.5, otherPerHour: 12, demandPerHour: scheduleRatePerHour(setup) };
}

/** Orders per hour in the setup's schedule (first to last release), or 60 when it cannot tell. */
export function scheduleRatePerHour(setup: Setup): number {
  const ts = setup.schedule.orders.map((o) => o.t).sort((a, b) => a - b);
  if (ts.length < 2) return 60;
  const span = (ts[ts.length - 1] as number) - (ts[0] as number);
  return span > 0 ? Math.round(((ts.length - 1) / span) * 3600) : 60;
}

/** The menu mix of the schedule, repeated to `n` orders, all released at t = 0. */
export function rushReleases(setup: Setup, n = CAPACITY_ORDERS): Releases {
  const items = setup.schedule.orders.length > 0 ? setup.schedule.orders.map((o) => o.itemId) : setup.menu.map((m) => m.id);
  if (items.length === 0) return [];
  return Array.from({ length: n }, (_, i) => ({ orderId: `rush-${i}`, itemId: items[i % items.length] as string, t: 0 }));
}

/** Mean margin per order over the schedule's mix. */
export function marginPerOrder(setup: Setup, econ: Economics): number {
  const items = setup.schedule.orders.length > 0 ? setup.schedule.orders.map((o) => o.itemId) : setup.menu.map((m) => m.id);
  if (items.length === 0) return 0;
  const sum = items.reduce((s, id) => s + (econ.menu[id]?.price ?? 0) - (econ.menu[id]?.ingredients ?? 0), 0);
  return sum / items.length;
}

export interface CapacityOptions {
  readonly reps?: number;
  readonly seed?: number;
  readonly table?: PathTable;
}

/** Orders per hour the kitchen finishes when it never runs out of orders. */
export function capacityPerHour(world: World, calibration: Calibration, opts: CapacityOptions = {}): Range {
  const reps = Math.max(1, Math.floor(opts.reps ?? PROFIT_REPS));
  const seed = mixSeed(opts.seed ?? PROFIT_SEED, 0xca9);
  const table = opts.table ?? buildPathTable(world);
  const model = compileEngineModel(world, calibration, table);
  const outside = walkExtrapolation(world, calibration, table).outside;
  const releases = rushReleases(world.setup);
  if (releases.length < 2) return { p10: 0, p50: 0, p90: 0 };
  const rates: number[] = [];
  for (let r = 0; r < reps; r += 1) {
    const rep = runEngine(model, releases, seed, r, { bootstrap: true, paceModels: outside ? "fit-or-speed" : "calibrated" });
    const done = rep.finishedAt.filter((t) => Number.isFinite(t));
    if (done.length < 2) {
      rates.push(0);
      continue;
    }
    const span = Math.max(...done) - Math.min(...done);
    rates.push(span > 0 ? ((done.length - 1) / span) * 3600 : 0);
  }
  return rangeOf(rates);
}

/** Profit per hour of this world, from a capacity range already worked out. */
export function profitFromCapacity(world: World, econ: Economics, capacity: Range): ProfitEstimate {
  const margin = marginPerOrder(world.setup, econ);
  const workers = world.workers.length;
  const wages = world.workers.reduce((total, worker) => total + (econ.workerWages?.[worker.id] ?? econ.wagePerHour), 0);
  const fixed = econ.electricityPerHour + econ.otherPerHour;
  const demand = Math.max(0, econ.demandPerHour);
  const sell = (c: number) => Math.min(demand, c);
  const sales: Range = { p10: sell(capacity.p10), p50: sell(capacity.p50), p90: sell(capacity.p90) };
  const mix = world.setup.schedule.orders.length ? world.setup.schedule.orders.map(o => o.itemId) : world.setup.menu.map(m => m.id);
  const price = mix.length ? mix.reduce((sum, id) => sum + (econ.menu[id]?.price ?? 0), 0) / mix.length : 0;
  const revenue = (s: number) => s * price;
  const profit = (s: number) => s * margin - wages - fixed;
  // Profit only grows with sales when the margin is positive; keep p10 <= p90 either way.
  const ps = [profit(sales.p10), profit(sales.p50), profit(sales.p90)].sort((a, b) => a - b);
  const rs = [revenue(sales.p10), revenue(sales.p50), revenue(sales.p90)].sort((a, b) => a - b);
  return {
    capacityPerHour: capacity,
    salesPerHour: sales,
    revenuePerHour: { p10: rs[0] as number, p50: rs[1] as number, p90: rs[2] as number },
    profitPerHour: { p10: ps[0] as number, p50: ps[1] as number, p90: ps[2] as number },
    marginPerOrder: margin,
    wagesPerHour: wages,
    fixedPerHour: fixed,
    workers,
    limitedBy: capacity.p50 < demand ? "capacity" : "demand",
  };
}

/** Profit per hour of this world. */
export function profitOf(world: World, calibration: Calibration, econ: Economics, opts: CapacityOptions = {}): ProfitEstimate {
  return profitFromCapacity(world, econ, capacityPerHour(world, calibration, opts));
}

/**
 * "$1,234", "−$56" or "$3.30": the sign before the currency. Amounts under 100
 * that are not whole show cents; everything else is whole units.
 */
export function formatMoney(value: number, currency: string): string {
  if (!Number.isFinite(value)) return "—";
  const cents = Math.round(value * 100);
  const showCents = Math.abs(value) < 100 && cents % 100 !== 0;
  const r = showCents ? cents / 100 : Math.round(value);
  const abs = Math.abs(r).toLocaleString("en-US", showCents ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { maximumFractionDigits: 0 });
  return `${r < 0 ? "−" : ""}${currency}${abs}`;
}

/** A range of money, "$410–$450", or "about $430" when both ends round together. */
export function formatMoneyRange(r: Range, currency: string): string {
  const step = Math.max(Math.abs(r.p10), Math.abs(r.p90)) >= 1000 ? 10 : 5;
  const lo = Math.floor(r.p10 / step) * step;
  const hi = Math.ceil(r.p90 / step) * step;
  if (hi - lo <= step) return `about ${formatMoney(Math.round(r.p50 / step) * step, currency)}`;
  return `${formatMoney(lo, currency)}–${formatMoney(hi, currency)}`;
}
