import { describe, expect, it } from "vitest";
import { cafeKit, kitLayout, kitScan, kitSetup, evenOrders } from "../../core/testkit";
import { resolveWorld, simulateRun } from "../../core";
import { ASSUMED_CALIBRATION, kitchenForShift, shiftOrders } from "./scenarios";

function kitchen() {
  const kit = cafeKit();
  return { scan: kitScan(kit), setup: kitSetup(kit), layout: kitLayout(kit) };
}

describe("shift and setup combinations", () => {
  it("uses the selected shift's order mix and arrival times in the selected setup", () => {
    const k = kitchen();
    const orders = shiftOrders(k, null);
    const shift = { ...orders, schedule: { orders: evenOrders(4, 12) } };
    const combined = kitchenForShift(k, shift);
    const trace = simulateRun(resolveWorld(combined.scan, combined.setup, combined.layout), ASSUMED_CALIBRATION);
    expect(trace.orders.map((o) => o.releasedAt)).toEqual([0, 12, 24, 36]);
    expect(trace.orders).toHaveLength(4);
    expect(k.setup.schedule).not.toBe(shift.schedule);
  });

  it("maps recipes and fetches to equivalent named items after a different scan", () => {
    const k = kitchen();
    const shift = shiftOrders(k, null);
    const target = { ...k, setup: { ...k.setup, items: k.setup.items.map((item) => ({ ...item, boxId: `new-${item.boxId}` })) } };
    const combined = kitchenForShift(target, shift);
    expect(combined.setup.menu[0]!.steps.map((step) => step.stationId)).toEqual(["new-order", "new-make", "new-finish"]);
    expect(combined.setup.menu[0]!.steps[1]!.fetchFrom).toEqual(["new-fridge"]);
    expect(shift.menu[0]!.steps[1]!.stationId).toBe("make");
  });

  it("rejects missing or ambiguous stations instead of silently using another recipe", () => {
    const k = kitchen();
    const shift = shiftOrders(k, null);
    const items = k.setup.items.filter((item) => item.boxId !== "make");
    expect(() => kitchenForShift({ ...k, setup: { ...k.setup, items } }, shift)).toThrow("needs make");
    const duplicates = [1, 2].map((i) => ({ ...k.setup.items.find((item) => item.boxId === "make")!, boxId: `make-${i}` }));
    expect(() => kitchenForShift({ ...k, setup: { ...k.setup, items: [...items, ...duplicates] } }, shift)).toThrow("matching station");
  });
});
