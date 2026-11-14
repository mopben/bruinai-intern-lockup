/**
 * Hand-made kitchens with exact answers for the engine tests (and later tasks).
 * Every box is 1 m square at z = 0 with its stand point at z = 0.85, so walks along
 * the stand line are straight and stand points 1 m apart or less are a hand-off.
 * Not part of the public API.
 */
import type { Calibration } from "../calibrate";
import type { WorkerDef } from "../types";
import { resolveWorld, type World } from "../world";
import { fixedCalibration, kitLayout, kitScan, kitSetup, worker, type KitSpec } from "../testkit";

export const buildKitchen = (spec: KitSpec): World => resolveWorld(kitScan(spec), kitSetup(spec), kitLayout(spec));

/**
 * One constant sample per pool, pace 1 m/s and no overhead: with `bootstrap: false`
 * every time is exact. `work` is keyed by station id, `taskWork` by `taskKey`.
 */
export function exactCalibration(work: Readonly<Record<string, number>>, taskWork: Readonly<Record<string, number>> = {}): Calibration {
  const pools = (r: Readonly<Record<string, number>>, n: number) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Array.from({ length: n }, () => v)]));
  return fixedCalibration(pools(work, 1), 1, pools(taskWork, 3));
}

/**
 * Join: tasks p (station a) and q (station b) start on release; r (station c) waits for both.
 * Stand points at x = 0 (a), 1 (c), 2 (b), 3 (pickup): every carry is a hand-off.
 */
export function joinKitchen(workers: readonly WorkerDef[] = [worker("wa", "a"), worker("wb", "b"), worker("wc", "c")]): KitSpec {
  return {
    boxes: [
      { id: "a", x: 0, z: 0, role: "station" },
      { id: "c", x: 1, z: 0, role: "station" },
      { id: "b", x: 2, z: 0, role: "station" },
      { id: "P", x: 3, z: 0, role: "pickup" },
    ],
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

/** Two items: "A" visits a then b, "B" visits only b. Stand points at x = 0, 1, 2 (pickup): hand-offs. */
export function twoItemKitchen(): KitSpec {
  return {
    boxes: [
      { id: "a", x: 0, z: 0, role: "station" },
      { id: "b", x: 1, z: 0, role: "station" },
      { id: "P", x: 2, z: 0, role: "pickup" },
    ],
    menu: [
      { id: "A", name: "A", steps: [{ stationId: "a" }, { stationId: "b" }] },
      { id: "B", name: "B", steps: [{ stationId: "b" }] },
    ],
    workers: [worker("wa", "a"), worker("wb", "b")],
    orders: [
      { orderId: "o1", itemId: "A", t: 0 },
      { orderId: "o2", itemId: "B", t: 0 },
    ],
  };
}

/** One worker at home a who also covers b, 4 m away; the pickup is a hand-off from b. */
export function coveringKitchen(): KitSpec {
  return {
    boxes: [
      { id: "a", x: 0, z: 0, role: "station" },
      { id: "b", x: 4, z: 0, role: "station" },
      { id: "P", x: 5, z: 0, role: "pickup" },
    ],
    menu: [{ id: "x", name: "X", steps: [{ stationId: "a" }, { stationId: "b" }] }],
    workers: [worker("w", "a", ["b"])],
    orders: [{ orderId: "o1", itemId: "x", t: 0 }],
  };
}

/** One station s with `workers` workers and an optional capacity; the pickup is a hand-off. */
export function capacityKitchen(workers: number, capacity?: number): KitSpec {
  return {
    boxes: [
      { id: "s", x: 0, z: 0, role: "station", ...(capacity !== undefined ? { capacity } : {}) },
      { id: "P", x: 1, z: 0, role: "pickup" },
    ],
    menu: [{ id: "x", name: "X", steps: [{ stationId: "s" }] }],
    workers: Array.from({ length: workers }, (_, i) => worker(`w${i + 1}`, "s")),
  };
}

/**
 * A covering worker walled off from its second station. Station z (stand (0, 5.85)) sits in a
 * closed ring of walls; its task hands its output across the south wall to b (stand (0, 6.75)).
 * Worker w1 lives at a (stand (3, 6.75)) and also covers z: that walk has no path.
 * Every menu walk is walkable or a hand-off, so only the covering walk is blocked.
 */
export function walledOffKitchen(): KitSpec {
  const wall = (id: string, x: number, z: number, w: number, yaw: number) => ({ id, center: { x, y: 1.2, z }, size: { w, h: 2.4, d: 0.1 }, yaw });
  return {
    boxes: [
      { id: "z", x: 0, z: 5, role: "station" },
      { id: "b", x: 0, z: 7.6, role: "station", standSide: "back" },
      { id: "a", x: 3, z: 7.6, role: "station", standSide: "back" },
      { id: "P", x: 6, z: 7.6, role: "pickup", standSide: "back" },
    ],
    walls: [wall("n", 0, 3.8, 4, 0), wall("s", 0, 6.35, 4, 0), wall("e", 1.8, 5.075, 2.55, Math.PI / 2), wall("w", -1.8, 5.075, 2.55, Math.PI / 2)],
    menu: [
      { id: "X", name: "X", steps: [{ stationId: "a" }] },
      { id: "Y", name: "Y", steps: [{ stationId: "z" }, { stationId: "b" }] },
    ],
    workers: [worker("w1", "a", ["z"]), worker("w2", "b")],
    orders: [
      { orderId: "o1", itemId: "Y", t: 0 },
      { orderId: "o2", itemId: "X", t: 0 },
    ],
  };
}
