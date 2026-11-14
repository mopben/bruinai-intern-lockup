import { describe, expect, it } from 'vitest';
import { cafeKit, kitScan, kitSetup, kitLayout } from './testkit';
import { resolveWorld } from './world';
import { estimateShiftProfit, compareShiftProfit } from './shift-profit';
import { ASSUMED_CALIBRATION } from '../stage/app/scenarios';
const kit = cafeKit();
const setup = kitSetup(kit);
const explicit = { ...setup, menu: setup.menu.map(m => ({ ...m, steps: m.steps.map(s => ({ ...s, workSeconds: 5 })) })) };
const world = resolveWorld(kitScan(kit), explicit, kitLayout(kit));
const economics = { wagePerHour: 20, electricityPerHour: 2, otherPerHour: 8, currency: '$' };
const shift = { durationSeconds: 3600, prices: { latte: { price: 10, ingredients: 2 } } };
describe('shift profit', () => {
  it('charges a full shift of wages and separates gross sales from ingredients', () => {
    const p = estimateShiftProfit(world, ASSUMED_CALIBRATION, economics, shift, 5);
    expect(p.completed).toBe(10);
    expect(p.revenue).toBe(100);
    expect(p.ingredients).toBe(20);
    expect(p.labor).toBe(60);
    expect(p.operating).toBe(10);
    expect(p.profit).toBe(10);
    expect(p.unfinished).toBe(0);
  });
  it('uses individual salaries including zero and ignores removed workers', () => {
    const p = estimateShiftProfit(world, ASSUMED_CALIBRATION, { ...economics, workerWages: { red: 30, blue: 0, removed: 999 } }, shift, 2);
    expect(p.labor).toBe(50);
  });
  it('charges started unfinished orders, excludes later arrivals, and never sells past closing', () => {
    const p = estimateShiftProfit(world, ASSUMED_CALIBRATION, economics, { ...shift, durationSeconds: 1 }, 3);
    expect(p.completed).toBe(0);
    expect(p.revenue).toBe(0);
    expect(p.ingredients).toBe(2);
    expect(p.unfinished).toBe(1);
    expect(p.profit).toBeLessThan(0);
  });
  it('handles an empty shift as zero sales with paid costs', () => {
    const empty = { ...world, setup: { ...world.setup, schedule: { orders: [] } } };
    const p = estimateShiftProfit(empty, ASSUMED_CALIBRATION, economics, shift, 2);
    expect(p.profit).toBe(-70);
    expect(p.completed).toBe(0);
  });
  it('pairs differences and prevents mixed currency comparisons', () => {
    const a = estimateShiftProfit(world, ASSUMED_CALIBRATION, economics, shift, 5);
    const b = estimateShiftProfit(world, ASSUMED_CALIBRATION, { ...economics, wagePerHour: 30 }, shift, 5);
    expect(compareShiftProfit(a, a).range).toEqual({ p10: 0, p50: 0, p90: 0 });
    expect(compareShiftProfit(a, b).difference).toBe(-30);
    expect(compareShiftProfit(a, { ...b, currency: 'EUR' }).difference).toBeNull();
  });
  it('labels default prices and costs and rejects invalid duration', () => {
    const p = estimateShiftProfit(world, ASSUMED_CALIBRATION, null, { ...shift, prices: {} }, 1);
    expect(p.assumptions.some(s => s.includes('Price'))).toBe(true);
    expect(() => estimateShiftProfit(world, ASSUMED_CALIBRATION, null, { ...shift, durationSeconds: 0 })).toThrow('duration');
  });
});
