import { compileEngineModel, runEngine } from './engine/index';
import { rangeOf, type Range } from './stats';
import type { World } from './world';
import type { Calibration } from './calibrate';
import type { Economics, MenuPrice } from './profit';
import { DEFAULT_SEED } from './predict';
import { walkExtrapolation } from './extrapolation';

export interface ShiftFinance { readonly durationSeconds: number; readonly prices: Readonly<Record<string, MenuPrice>> }
export interface FinancialSample { readonly revenue: number; readonly ingredients: number; readonly labor: number; readonly operating: number; readonly profit: number; readonly completed: number; readonly unfinished: number }
export interface ShiftProfit extends FinancialSample { readonly range: Range; readonly samples: readonly FinancialSample[]; readonly durationSeconds: number; readonly currency: string; readonly assumptions: readonly string[] }

/** Estimate a finite shift immediately; playback is independent of these samples. */
export function estimateShiftProfit(world: World, cal: Calibration, economics: Partial<Economics> | null, shift: ShiftFinance, reps = 100): ShiftProfit {
  if (!Number.isFinite(shift.durationSeconds) || shift.durationSeconds <= 0) throw new Error('Set a positive shift duration in Orders.');
  const duration = shift.durationSeconds;
  const hours = duration / 3600;
  const assumptions: string[] = [];
  const cost = (value: unknown, fallback: number, name: string) => {
    if (value === undefined) { assumptions.push(`${name} uses an example value.`); return fallback; }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`${name} must be a nonnegative number.`);
    return value;
  };
  const labor = world.workers.reduce((sum, worker) => sum + cost(economics?.workerWages?.[worker.id] ?? economics?.wagePerHour, 18, `Pay for ${worker.name}`), 0) * hours;
  const operating = (cost(economics?.electricityPerHour, 1.5, 'Electricity') + cost(economics?.otherPerHour, 12, 'Other operating costs')) * hours;
  const prices: Record<string, MenuPrice> = {};
  for (const id of new Set(world.setup.schedule.orders.filter(o => o.t < duration).map(o => o.itemId))) {
    const p = shift.prices[id] ?? economics?.menu?.[id];
    prices[id] = { price: cost(p?.price, 4.5, `Price for ${id}`), ingredients: cost(p?.ingredients, 1.2, `Ingredients for ${id}`) };
  }
  const releases = world.setup.schedule.orders.filter(o => o.t < duration);
  const model = releases.length ? compileEngineModel(world, cal) : null;
  const paceModels = model && walkExtrapolation(world, cal, model.table).outside ? 'fit-or-speed' : 'calibrated';
  const samples: FinancialSample[] = [];
  for (let rep = 0; rep < Math.max(1, Math.floor(reps)); rep++) {
    const result = model ? runEngine(model, releases, DEFAULT_SEED, rep, { trace: true, bootstrap: true, paceModels }) : null;
    let revenue = 0, ingredients = 0, completed = 0;
    for (const order of result?.trace?.orders ?? []) {
      const p = prices[order.itemId]!;
      if (order.steps.some(step => step.startedAt !== null && step.startedAt < duration)) ingredients += p.ingredients;
      if (order.finishedAt !== null && Number.isFinite(order.finishedAt) && order.finishedAt <= duration) { completed++; revenue += p.price; }
    }
    samples.push({ revenue, ingredients, labor, operating, profit: revenue - ingredients - labor - operating, completed, unfinished: releases.length - completed });
  }
  const average = (key: keyof FinancialSample) => samples.reduce((sum, sample) => sum + sample[key], 0) / samples.length;
  return { revenue: average('revenue'), ingredients: average('ingredients'), labor, operating, profit: average('profit'), completed: average('completed'), unfinished: average('unfinished'), range: rangeOf(samples.map(s => s.profit)), samples, durationSeconds: duration, currency: economics?.currency?.trim() || '$', assumptions: [...new Set([...assumptions, ...(cal.walkSpeedAssumed ? ['Walking pace assumed at 1.2 m/s.'] : [])])] };
}

export function compareShiftProfit(left: ShiftProfit, right: ShiftProfit) {
  if (left.currency !== right.currency) return { problem: 'Choose the same currency for both setups to compare profit.', difference: null, range: null };
  const differences = left.samples.map((sample, index) => right.samples[index]!.profit - sample.profit);
  return { problem: null, difference: right.profit - left.profit, range: rangeOf(differences) };
}
