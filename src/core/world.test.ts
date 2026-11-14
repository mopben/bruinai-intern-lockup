import { describe, expect, it } from "vitest";
import { resolveWorld, standPoint, WorldError, itemOf } from "./world";
import { kitLayout, kitScan, kitSetup, worker, type KitSpec } from "./testkit";
import { vec } from "./geometry";

const base: KitSpec = {
  boxes: [
    { id: "A", x: 0, z: 0, role: "station" },
    { id: "F", x: 3, z: 0, role: "storage" },
    { id: "P", x: 6, z: 0, role: "pickup" },
    { id: "noise", x: 9, z: 9, role: "ignore" },
  ],
  menu: [{ id: "latte", name: "Latte", steps: [{ stationId: "A", fetchFrom: ["F"] }] }],
  workers: [worker("w1", "A")],
  orders: [{ orderId: "o1", itemId: "latte", t: 0 }],
};

function errorsOf(fn: () => unknown): readonly string[] {
  try {
    fn();
  } catch (e) {
    if (e instanceof WorldError) return e.issues;
    throw e;
  }
  return [];
}

describe("resolveWorld", () => {
  it("resolves items, skips ignored boxes, and puts stand points STAND_OFF_M out", () => {
    const w = resolveWorld(kitScan(base), kitSetup(base), kitLayout(base));
    expect(w.items.map((i) => i.id)).toEqual(["A", "F", "P"]);
    expect(itemOf(w, "A").stand.z).toBeCloseTo(0.85);
    expect(w.obstacles).toHaveLength(3);
    expect(w.warnings).toEqual([]);
  });

  it("uses the layout placement when present", () => {
    const layout = { ...kitLayout(base), placements: { F: { x: 1, z: 2, yaw: Math.PI / 2 } } };
    const w = resolveWorld(kitScan(base), kitSetup(base), layout);
    const f = itemOf(w, "F");
    expect(f.rect.center).toEqual(vec(1, 2));
    // yaw pi/2: front faces +x
    expect(f.stand.x).toBeCloseTo(1.85);
    expect(f.stand.z).toBeCloseTo(2);
  });

  it("stand sides go out from the named side", () => {
    const r = { center: vec(0, 0), halfW: 1, halfD: 0.5, yaw: 0 };
    expect(standPoint(r, "back").z).toBeCloseTo(-0.85);
    expect(standPoint(r, "right").x).toBeCloseTo(1.35);
    expect(standPoint(r, "left").x).toBeCloseTo(-1.35);
  });

  it("treats a scanned box with no setup as a fixture and warns", () => {
    const setup = kitSetup(base);
    const w = resolveWorld(kitScan(base), { ...setup, items: setup.items.filter((i) => i.boxId !== "noise") }, kitLayout(base));
    expect(itemOf(w, "noise").role).toBe("fixture");
    expect(w.warnings[0]).toMatch(/noise/);
  });

  it("lists every problem clearly", () => {
    const setup = kitSetup(base);
    const bad = {
      ...setup,
      pickupId: "A",
      items: [...setup.items, { boxId: "ghost", name: "Ghost", role: "station" as const, locked: false }],
      menu: [{ id: "latte", name: "Latte", steps: [{ stationId: "F", fetchFrom: ["P"] }] }],
      schedule: { orders: [{ orderId: "o1", itemId: "mocha", t: 0 }, { orderId: "o1", itemId: "latte", t: 1 }] },
    };
    const layout = { ...kitLayout(base), placements: { nope: { x: 0, z: 0, yaw: 0 } }, workers: [worker("w1", "P"), worker("w1", "A")] };
    const issues = errorsOf(() => resolveWorld(kitScan(base), bad, layout));
    const text = issues.join("\n");
    expect(text).toMatch(/"ghost", which is not in the scan/);
    expect(text).toMatch(/places box "nope"/);
    expect(text).toMatch(/Pickup "A"/);
    expect(text).toMatch(/at "F", which is not a station/);
    expect(text).toMatch(/fetches from "P"/);
    expect(text).toMatch(/"mocha", which is not on the menu/);
    expect(text).toMatch(/"o1" appears twice/);
    expect(text).toMatch(/Worker "w1" stands at "P"/);
    expect(text).toMatch(/Worker id "w1" appears twice/);
  });

  it("reports duplicate setup entries, empty menus and empty steps", () => {
    const setup = kitSetup(base);
    const dup = { ...setup, items: [...setup.items, setup.items[0]!], menu: [] };
    expect(errorsOf(() => resolveWorld(kitScan(base), dup, kitLayout(base))).join("\n")).toMatch(/set up twice[\s\S]*no items/);
    const noSteps = { ...setup, menu: [{ id: "latte", name: "Latte", steps: [] }] };
    expect(errorsOf(() => resolveWorld(kitScan(base), noSteps, kitLayout(base))).join()).toMatch(/no steps/);
  });

  it("rejects a menu item whose tasks have a problem", () => {
    const setup = kitSetup(base);
    const menu = [{ id: "latte", name: "Latte", steps: [{ stationId: "A" }], tasks: [{ id: "p", stationId: "A", after: ["zz"] }] }];
    expect(errorsOf(() => resolveWorld(kitScan(base), { ...setup, menu }, kitLayout(base))).join()).toMatch(/"zz"/);
  });

  it("rejects a worker who covers something that is not a station", () => {
    const layout = { ...kitLayout(base), workers: [worker("w1", "A", ["F"])] };
    expect(errorsOf(() => resolveWorld(kitScan(base), kitSetup(base), layout)).join()).toMatch(/Worker "w1" covers "F"/);
  });

  it.each([0, 1.5, -1])("rejects a capacity of %s", (capacity) => {
    const spec = { ...base, boxes: base.boxes.map((b) => (b.id === "A" ? { ...b, capacity } : b)) };
    expect(errorsOf(() => resolveWorld(kitScan(spec), kitSetup(spec), kitLayout(spec))).join()).toMatch(/capacity/);
  });

  it("accepts tasks, covers and a whole capacity", () => {
    const spec: KitSpec = {
      ...base,
      boxes: [...base.boxes.map((b) => (b.id === "A" ? { ...b, capacity: 2 } : b)), { id: "B", x: 0, z: 3, role: "station" }],
      menu: [{ id: "latte", name: "Latte", steps: [{ stationId: "A" }, { stationId: "B" }], tasks: [{ id: "p", stationId: "A" }, { id: "q", stationId: "B", after: ["p"] }] }],
      workers: [worker("w1", "A", ["B"])],
    };
    expect(resolveWorld(kitScan(spec), kitSetup(spec), kitLayout(spec)).warnings).toEqual([]);
  });

  it("itemOf gives a clear error for unknown ids", () => {
    const w = resolveWorld(kitScan(base), kitSetup(base), kitLayout(base));
    expect(() => itemOf(w, "noise")).toThrow(/No item "noise"/);
  });
});
