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

/** Stations a, b, c 3 m apart on one line, pickup P at x = 10; the join item of tasks.test.ts. */
function joinKitchen(workers: KitSpec["workers"], extra: KitSpec["boxes"] = [], walls: KitSpec["walls"] = []): KitSpec {
  return {
    boxes: [
      { id: "a", x: 0, z: 0, role: "station" },
      { id: "b", x: 3, z: 0, role: "station" },
      { id: "c", x: 6, z: 0, role: "station" },
      { id: "P", x: 10, z: 0, role: "pickup" },
      ...extra,
    ],
    walls,
    menu: [
      {
        id: "x",
        name: "X",
        steps: [{ stationId: "a" }, { stationId: "b" }, { stationId: "c" }],
        tasks: [{ id: "p", stationId: "a" }, { id: "q", stationId: "b" }, { id: "r", stationId: "c", after: ["p", "q"] }],
      },
    ],
    workers,
    orders: [{ orderId: "o1", itemId: "x", t: 0 }],
  };
}

const fixedJoinWorkers = [worker("w1", "a"), worker("w2", "b"), worker("w3", "c")];

describe("walking from task graphs", () => {
  it("carries each task to the task it feeds, and the last to the pickup", () => {
    // Stand points on z = 0.85 at x = 0, 3, 6, 10.
    // carry p a->c: 6 - 0 = 6 m; carry q b->c: 6 - 3 = 3 m; carry r c->P: 10 - 6 = 4 m.
    // Total there and back: 2 * (6 + 3 + 4) = 26 m.
    const w = walkingForItem(world(joinKitchen(fixedJoinWorkers)), "x");
    expect(w.legs.map((l) => [l.kind, l.step, l.fromId, l.toId, +l.oneWayM.toFixed(6)])).toEqual([
      ["carry", 0, "a", "c", 6],
      ["carry", 1, "b", "c", 3],
      ["carry", 2, "c", "P", 4],
    ]);
    expect(w.totalM).toBeCloseTo(26, 9);
    expect(w.anyBlocked).toBe(false);
  });

  it("holds the walk between the stations a covering worker covers", () => {
    const fixed = buildPathTable(world(joinKitchen(fixedJoinWorkers)));
    const wc = world(joinKitchen([worker("w1", "a", ["b"]), worker("w3", "c")]));
    const t = buildPathTable(wc);
    // a <-> b is no menu walk; the covering worker adds it (both ways).
    expect(t.paths.size).toBe(fixed.paths.size + 2);
    const ab = pathBetween(wc, t, "a", "b");
    expect([...t.paths.values()]).toContain(ab);
    expect(ab.length).toBeCloseTo(3, 9);
  });

  it("does not throw when a covering worker is walled off from its second station", () => {
    // Station z at (0, 5), stand (0, 5.85), inside a closed ring of walls.
    const ring: NonNullable<KitSpec["walls"]> = [
      { id: "n", center: { x: 0, y: 1.2, z: 3.8 }, size: { w: 4, h: 2.4, d: 0.1 }, yaw: 0 },
      { id: "s", center: { x: 0, y: 1.2, z: 7.2 }, size: { w: 4, h: 2.4, d: 0.1 }, yaw: 0 },
      { id: "e", center: { x: 1.8, y: 1.2, z: 5.5 }, size: { w: 3.8, h: 2.4, d: 0.1 }, yaw: Math.PI / 2 },
      { id: "w", center: { x: -1.8, y: 1.2, z: 5.5 }, size: { w: 3.8, h: 2.4, d: 0.1 }, yaw: Math.PI / 2 },
    ];
    const spec = joinKitchen([worker("w1", "a", ["z"]), worker("w2", "b"), worker("w3", "c")], [{ id: "z", x: 0, z: 5, role: "station" }], ring);
    const wz = world(spec);
    const t = buildPathTable(wz);
    const az = pathBetween(wz, t, "a", "z");
    expect([...t.paths.values()]).toContain(az);
    expect(az.blocked).toBe(true);
    expect(walkingForItem(wz, "x", t).anyBlocked).toBe(false);
  });
});
