import { describe, expect, it } from "vitest";
import { resolveWorld } from "./world";
import { buildPathTable, pathBetween, walkingForItem, walkingPerOrder } from "./walking";
import { kitLayout, kitScan, kitSetup, worker, type KitSpec } from "./testkit";

/**
 * Line of 1x1 boxes on z = 0, all standing on the front (z = 0.85).
 * Straight walks along z = 0.85 clear every grown box (which reach z = 0.75).
 */
function lineKitchen(fridgeX: number, bX = 3): KitSpec {
  return {
    boxes: [
      { id: "A", x: 0, z: 0, role: "station" },
      { id: "B", x: bX, z: 0, role: "station" },
      { id: "F", x: fridgeX, z: 0, role: "storage" },
      { id: "P", x: 10, z: 0, role: "pickup" },
    ],
    menu: [{ id: "latte", name: "Latte", steps: [{ stationId: "A" }, { stationId: "B", fetchFrom: ["F"] }] }],
    workers: [worker("w1", "A"), worker("w2", "B")],
    orders: [{ orderId: "o1", itemId: "latte", t: 0 }],
  };
}

const world = (spec: KitSpec) => resolveWorld(kitScan(spec), kitSetup(spec), kitLayout(spec));

describe("walking per order", () => {
  it("equals the hand-computed sum of round trips", () => {
    // carry A->B 3 m (x2), fetch B->F 3 m (x2), carry B->P 7 m (x2) = 26 m
    const w = walkingForItem(world(lineKitchen(6)), "latte");
    expect(w.totalM).toBeCloseTo(26, 9);
    expect(w.legs.map((l) => [l.kind, l.step, l.fromId, l.toId, +l.oneWayM.toFixed(6)])).toEqual([
      ["carry", 0, "A", "B", 3],
      ["fetch", 1, "B", "F", 3],
      ["carry", 1, "B", "P", 7],
    ]);
    expect(w.anyBlocked).toBe(false);
  });

  it("moving the fridge 2 m closer saves exactly 4 m (there and back)", () => {
    const far = walkingForItem(world(lineKitchen(6)), "latte").totalM;
    const near = walkingForItem(world(lineKitchen(4)), "latte").totalM;
    expect(far - near).toBeCloseTo(4, 9);
  });

  it("hands off by hand at exactly HANDOFF_REACH_M, walks just beyond it", () => {
    const at = walkingForItem(world(lineKitchen(6, 1)), "latte");
    expect(at.legs[0]).toMatchObject({ handoff: true, roundTripM: 0 });
    const beyond = walkingForItem(world(lineKitchen(6, 1.001)), "latte");
    expect(beyond.legs[0]?.handoff).toBe(false);
    expect(beyond.legs[0]?.roundTripM).toBeCloseTo(2.002, 9);
  });

  it("walks round an obstacle in the way", () => {
    // A sink box between A and B on the walking line: 1x1 at (1.5, 0.85).
    const spec = lineKitchen(6);
    const withSink: KitSpec = { ...spec, boxes: [...spec.boxes, { id: "S", x: 1.5, z: 0.85, role: "fixture" }] };
    const w = world(withSink);
    const p = pathBetween(w, undefined, "A", "B");
    // Grown sink spans x 0.75..2.25, z 0.1..1.6. A is at (0,0.85): the route goes over the top corners (z=1.6).
    const expected = 2 * Math.hypot(0.75, 0.75) + 1.5;
    expect(p.length).toBeCloseTo(expected, 9);
    expect(walkingForItem(w, "latte").legs[0]?.oneWayM).toBeCloseTo(expected, 9);
  });

  it("summarises per order over the schedule and reuses a path table", () => {
    const w = world(lineKitchen(6));
    const t = buildPathTable(w);
    expect(walkingPerOrder(w, t).perOrderM).toBeCloseTo(26, 9);
    expect(walkingPerOrder(w).anyBlocked).toBe(false);
    expect(pathBetween(w, t, "F", "B").points[0]?.x).toBeCloseTo(6);
    expect(() => walkingForItem(w, "mocha")).toThrow(/mocha/);
  });
});
