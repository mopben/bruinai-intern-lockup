import { describe, expect, it } from "vitest";
import { cafeKit, kitLayout, kitScan, kitSetup } from "../../core/testkit";
import { predict, resolveWorld, simulateRun } from "../../core";
import { setupSchema } from "../../inputs/schemas";
import { DEMO_HOURLY_ORDERS, DEMO_SHIFT_SECONDS, demoShift } from "./demo-shift";
import { ASSUMED_CALIBRATION } from "./scenarios";
import { setRecipeQuantity } from "./recipes";

describe("six-hour café demo", () => {
  it("mixes 360 drinks across six hours, peaking during the morning rush", () => {
    const setup = kitSetup(cafeKit());
    const demo = demoShift(setup);
    expect(demo.durationSeconds).toBe(21600);
    expect(demo.schedule.orders).toHaveLength(360);
    expect(demo.menu.map(recipe => demo.schedule.orders.filter(order => order.itemId === recipe.id).length)).toEqual([180, 108, 72]);
    expect(DEMO_HOURLY_ORDERS.map((_, hour) => demo.schedule.orders.filter(order => Math.floor(order.t / 3600) === hour).length)).toEqual(DEMO_HOURLY_ORDERS);
    expect(demo.schedule.orders.every(order => order.t >= 0 && order.t < DEMO_SHIFT_SECONDS)).toBe(true);
    expect(new Set(demo.schedule.orders.map(order => order.orderId)).size).toBe(360);
    expect(demoShift(setup)).toEqual(demo);
    expect(setup.schedule.orders).toHaveLength(10);
    expect(demo.menu.find(recipe => recipe.id === "espresso")!.steps.every(step => !step.fetchFrom)).toBe(true);
  });

  it("runs with finite predictions and supports editing quantities above 30", () => {
    const kit = cafeKit();
    const original = kitSetup(kit);
    const demo = demoShift(original);
    const setup = setupSchema.parse({ ...original, menu: demo.menu, schedule: demo.schedule });
    const kitchen = { scan: kitScan(kit), layout: kitLayout(kit), setup };
    const world = resolveWorld(kitchen.scan, setup, kitchen.layout);
    expect(Number.isFinite(predict(world, ASSUMED_CALIBRATION, { reps: 5 }).meanOrderTime.p50)).toBe(true);
    const trace = simulateRun(world, ASSUMED_CALIBRATION);
    expect(trace.orders).toHaveLength(360);
    expect(trace.endT).toBeGreaterThan(5 * 3600);
    expect(trace.endT).toBeLessThan(DEMO_SHIFT_SECONDS);
    const edited = setRecipeQuantity(kitchen, "latte", 200);
    expect(edited.setup.schedule.orders.filter(order => order.itemId === "latte")).toHaveLength(200);
  });
});
