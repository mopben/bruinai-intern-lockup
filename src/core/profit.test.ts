import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Layout, PositionSample, Scan, Setup, TapEvent } from "./types";
import {
  calibrate,
  capacityPerHour,
  EXAMPLE_DEMAND_PER_HOUR,
  EXAMPLE_WORK_S,
  median,
  withRealWork,
  workSOf,
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
  wageOf,
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
  it("adds up: sales x margin, less wages and running costs", () => {
    const cap = { p10: 100, p50: 120, p90: 140 };
    const e = { ...econ, demandPerHour: 1000, wagePerHour: 20, electricityPerHour: 2, otherPerHour: 8, menu: { latte: { price: 5, ingredients: 1 } } };
    const p = profitFromCapacity(world, e, cap);
    expect(p.marginPerOrder).toBe(4);
    expect(p.wagesPerHour).toBe(3 * 20);
    expect(p.profitPerHour.p50).toBeCloseTo(120 * 4 - 60 - 10);
    expect(p.limitedBy).toBe("capacity");
  });

  it("pays each worker their own wage where one is set", () => {
    const cap = { p10: 100, p50: 120, p90: 140 };
    const [a, b] = world.workers;
    const e = { ...econ, wagePerHour: 20, wageByWorker: { [a!.id]: 30, [b!.id]: 15, nobody: 999 } };
    const p = profitFromCapacity(world, e, cap);
    expect(p.wagesPerHour).toBe(30 + 15 + 20);
    expect(wageOf(e, a!.id)).toBe(30);
    expect(wageOf(e, "someone-new")).toBe(20);
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

  it("stretches each station's work to its real time, keeping the spread and the walking pace", () => {
    const make = setup.menu[0]!.steps[1]!.stationId;
    const real = withRealWork(cal, { ...econ, workS: { [make]: 50 } });
    for (const [id, samples] of Object.entries(real.workSamples)) {
      const before = cal.workSamples[id]!;
      expect(median(samples)).toBeCloseTo(id === make ? 50 : EXAMPLE_WORK_S);
      const k = (samples[0] as number) / (before[0] as number);
      samples.forEach((v, i) => expect(v).toBeCloseTo((before[i] as number) * k));
    }
    expect(real.walkSpeedMps).toBe(cal.walkSpeedMps);
    expect(real.walkOverheadS).toBe(cal.walkOverheadS);
    expect(workSOf({ ...econ, workS: { [make]: 0 } }, make)).toBe(EXAMPLE_WORK_S);
  });

  it("at real work times the example kitchen makes a café's worth an hour, and cannot quite keep up", () => {
    const a = profitOf(world, cal, econ);
    expect(a.capacityPerHour.p50).toBeGreaterThan(40);
    expect(a.capacityPerHour.p50).toBeLessThan(econ.demandPerHour);
    expect(a.limitedBy).toBe("capacity");
    // In rehearsal time it would make hundreds an hour.
    expect(capacityPerHour(world, cal).p50).toBeGreaterThan(300);
  });

  it("with the espresso machine the slow station, a closer fridge and a fourth worker there both make more profit", () => {
    const [till, make, finish] = setup.menu[0]!.steps.map((st) => st.stationId);
    const e = { ...econ, workS: { [till!]: 20, [make!]: 45, [finish!]: 25 } };
    const at = (run: string) => profitOf(resolveWorld(scan, setup, read<Layout>(run, "layout.json")), cal, e);
    const a = at("counter-a");
    expect(at("counter-b-fridge-closer").profitPerHour.p50).toBeGreaterThan(a.profitPerHour.p50 + 5);
    expect(at("counter-c-fourth-worker").profitPerHour.p50).toBeGreaterThan(a.profitPerHour.p50 + 5);
  });

  it("in a rush at the recorded pace, a closer fridge sells more", () => {
    const rush = { ...econ, demandPerHour: scheduleRatePerHour(setup) };
    const a = profitOf(world, cal, rush);
    const b = profitOf(resolveWorld(scan, setup, read<Layout>("counter-b-fridge-closer", "layout.json")), cal, rush);
    expect(a.limitedBy).toBe("capacity");
    expect(b.profitPerHour.p50).toBeGreaterThan(a.profitPerHour.p50);
  });

  it("is the same for the same layout (fixed seed)", () => {
    expect(profitOf(world, cal, econ)).toEqual(profitOf(world, cal, econ));
  });

  it("takes the example mix from the recorded schedule, but not its rehearsal pace as demand", () => {
    expect(scheduleRatePerHour(setup)).toBeGreaterThan(500);
    expect(econ.demandPerHour).toBe(EXAMPLE_DEMAND_PER_HOUR);
    expect(econ.demandPerHour).toBeLessThan(scheduleRatePerHour(setup) / 4);
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
