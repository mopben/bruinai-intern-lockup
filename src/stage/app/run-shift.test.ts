import { describe, expect, it } from "vitest";
import { cafeKit, kitLayout, kitScan, kitSetup } from "../../core/testkit";
import type { Kitchen } from "./kitchen-edit";
import { hasCafeMenu, runShift, RUN_SHIFT_ORDERS, RUN_SHIFT_SECONDS } from "./run-shift";
import { ASSUMED_CALIBRATION } from "./scenarios";

function ownKitchen(): Kitchen {
  const kit = cafeKit();
  const setup = kitSetup(kit);
  const stations = setup.items.filter((i) => i.role === "station").map((i) => i.boxId);
  const menu = [
    { id: "combo", name: "Drink + chips combo", steps: stations.slice(0, 2).map((stationId) => ({ stationId })) },
    { id: "side", name: "Chips only", steps: [{ stationId: stations[0]!, workSeconds: 4 }] },
  ];
  return { scan: kitScan(kit), layout: kitLayout(kit), setup: { ...setup, menu, schedule: { orders: [{ orderId: "o1", itemId: "combo", t: 0 }] } } };
}

describe("a new shift for a kitchen with its own menu", () => {
  it("tells the bundled café counter from a kitchen with its own menu", () => {
    expect(hasCafeMenu(kitSetup(cafeKit()))).toBe(true);
    expect(hasCafeMenu(ownKitchen().setup)).toBe(false);
  });
  it("keeps the kitchen's own orders, stations and measured seconds", () => {
    const k = ownKitchen();
    const [first, second] = k.setup.menu[0]!.steps.map((s) => s.stationId);
    const shift = runShift(k, { ...ASSUMED_CALIBRATION, workSamples: { [first!]: [5, 6], [second!]: [6.5] } });
    expect(shift.menu.map((r) => r.name)).toEqual(["Drink + chips combo", "Chips only"]);
    expect(shift.menu[0]!.steps).toEqual([{ stationId: first, workSeconds: 5.5 }, { stationId: second, workSeconds: 6.5 }]);
    expect(shift.menu[1]!.steps[0]!.workSeconds).toBe(4);
    expect(shift.items).toBe(k.setup.items);
    expect(shift.prices).toEqual({});
  });
  it("uses the default seconds for a step with no measurement", () => {
    const shift = runShift(ownKitchen(), null);
    expect(shift.menu[0]!.steps.every((s) => s.workSeconds === 10)).toBe(true);
  });
  it("spreads sixty orders over one hour, the same every time", () => {
    const shift = runShift(ownKitchen(), null);
    expect(shift.durationSeconds).toBe(RUN_SHIFT_SECONDS);
    expect(shift.schedule.orders).toHaveLength(RUN_SHIFT_ORDERS);
    expect(shift.schedule.orders.filter((o) => o.itemId === "combo")).toHaveLength(30);
    expect(shift.schedule.orders.every((o, i, all) => o.t >= 0 && o.t < RUN_SHIFT_SECONDS && (i === 0 || o.t >= all[i - 1]!.t))).toBe(true);
    expect(new Set(shift.schedule.orders.map((o) => o.orderId)).size).toBe(RUN_SHIFT_ORDERS);
    expect(runShift(ownKitchen(), null).schedule).toEqual(shift.schedule);
  });
});
