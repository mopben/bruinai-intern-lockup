import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Layout, PositionSample, Scan, Setup, TapEvent } from "./types";
import {
  calibrate,
  capacityPerHour,
  exampleEconomics,
  formatMoney,
  formatMoneyRange,
  marginPerOrder,
  profitFromCapacity,
  profitOf,
  reconstructRun,
  resolveWorld,
  rushReleases,
  scheduleRatePerHour,
} from "./index";

const dir = join(__dirname, "..", "..", "fixtures");
const read = <T>(run: string, f: string) => JSON.parse(readFileSync(join(dir, run, f), "utf8")) as T;
const lines = <T>(run: string, f: string) =>
  readFileSync(join(dir, run, f), "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as { type: string })
    .filter((l) => l.type !== "header") as T[];

const scan = read<Scan>("counter-a", "scan.json");
const setup = read<Setup>("counter-a", "setup.json");
const layout = read<Layout>("counter-a", "layout.json");
const world = resolveWorld(scan, setup, layout);
const cal = calibrate(world, reconstructRun(setup, lines<TapEvent>("counter-a", "taps.jsonl")), lines<PositionSample>("counter-a", "positions.jsonl"));
const econ = exampleEconomics(setup);

describe("profit", () => {
  it("uses individual salaries and the default for workers without an override", () => {
    const first = world.workers[0]!;
    const second = world.workers[1]!;
    const e = { ...econ, wagePerHour: 20, workerWages: { [first.id]: 25.5, [second.id]: 0, removedWorker: 1000 } };
    const p = profitFromCapacity(world, e, { p10: 100, p50: 120, p90: 140 });
    expect(p.wagesPerHour).toBe(25.5 + (world.workers.length - 2) * 20);
  });

  it("adds up: sales x margin, less wages and running costs", () => {
    const cap = { p10: 100, p50: 120, p90: 140 };
    const e = { ...econ, demandPerHour: 1000, wagePerHour: 20, electricityPerHour: 2, otherPerHour: 8, menu: { latte: { price: 5, ingredients: 1 } } };
    const p = profitFromCapacity(world, e, cap);
    expect(p.marginPerOrder).toBe(4);
    expect(p.wagesPerHour).toBe(3 * 20);
    expect(p.profitPerHour.p50).toBeCloseTo(120 * 4 - 60 - 10);
    expect(p.limitedBy).toBe("capacity");
  });

  it("sells no more than comes in", () => {
    const p = profitFromCapacity(world, { ...econ, demandPerHour: 50 }, { p10: 100, p50: 120, p90: 140 });
    expect(p.salesPerHour).toEqual({ p10: 50, p50: 50, p90: 50 });
    expect(p.limitedBy).toBe("demand");
  });

  it("keeps the range in order when every order loses money", () => {
    const e = { ...econ, menu: { latte: { price: 1, ingredients: 3 } } };
    const p = profitFromCapacity(world, e, { p10: 100, p50: 120, p90: 140 });
    expect(p.profitPerHour.p10).toBeLessThanOrEqual(p.profitPerHour.p50);
    expect(p.profitPerHour.p50).toBeLessThanOrEqual(p.profitPerHour.p90);
    expect(marginPerOrder(setup, e)).toBe(-2);
  });

  it("measures capacity from the run: a closer fridge and a fourth worker both make more an hour", () => {
    const a = capacityPerHour(world, cal);
    const b = capacityPerHour(resolveWorld(scan, setup, read<Layout>("counter-b-fridge-closer", "layout.json")), cal);
    const c = capacityPerHour(resolveWorld(scan, setup, read<Layout>("counter-c-fourth-worker", "layout.json")), cal);
    expect(a.p10).toBeLessThanOrEqual(a.p50);
    expect(a.p50).toBeLessThanOrEqual(a.p90);
    expect(a.p50).toBeGreaterThan(0);
    expect(b.p50).toBeGreaterThan(a.p50);
    expect(c.p50).toBeGreaterThan(a.p50);
  });

  it("is the same for the same layout (fixed seed)", () => {
    expect(profitOf(world, cal, econ)).toEqual(profitOf(world, cal, econ));
  });

  it("takes the example demand and mix from the recorded schedule", () => {
    expect(scheduleRatePerHour(setup)).toBeGreaterThan(0);
    const rush = rushReleases(setup);
    expect(rush.every((o) => o.t === 0 && o.itemId === "latte")).toBe(true);
    expect(new Set(rush.map((o) => o.orderId)).size).toBe(rush.length);
  });

  it("formats money plainly", () => {
    expect(formatMoney(1234.4, "$")).toBe("$1,234");
    expect(formatMoney(-56.2, "€")).toBe("−€56.20");
    expect(formatMoney(3.3, "$")).toBe("$3.30");
    expect(formatMoney(54, "$")).toBe("$54");
    expect(formatMoney(-480.4, "$")).toBe("−$480");
    expect(formatMoneyRange({ p10: 412, p50: 430, p90: 448 }, "$")).toBe("$410–$450");
    expect(formatMoneyRange({ p10: 431, p50: 432, p90: 434 }, "$")).toBe("about $430");
  });
});
