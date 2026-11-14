import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveWorld, type Layout, type Scan, type Setup } from "../../core";
import {
  addFloorMark,
  addRouteStation,
  addWorker,
  canSplit,
  moveRouteStep,
  removeRouteStep,
  removeWorker,
  renameItem,
  setLocked,
  setRole,
  setStandSide,
  splitBox,
  toggleFetch,
  workersAt,
  type Kitchen,
} from "./kitchen-edit";
import { HAT_COLORS } from "./starter-setup";

const dir = join(__dirname, "../../../fixtures/counter-a");
const read = <T>(f: string) => JSON.parse(readFileSync(join(dir, f), "utf8")) as T;
const kitchen: Kitchen = Object.freeze({ scan: read<Scan>("scan.json"), setup: read<Setup>("setup.json"), layout: read<Layout>("layout.json") });
const ids = {
  order: "61A93A22-761D-47DF-BC5F-5EB3A7D8334A",
  make: "98EA7E27-B557-42A2-9AE3-1C7A609FDAC0",
  finish: "9886D544-4186-4B47-978D-7D032CCECDEA",
  fridge: "65E69210-5EED-4D93-9F34-955C39B9EDBF",
  pickup: "81C9EBC2-31C1-4C98-879A-0EAB5851BF60",
  sink: "CDE6CBCE-51B0-43F3-8352-3709255BFE67",
};
const snapshot = JSON.stringify(kitchen);
const item = (k: Kitchen, id: string) => k.setup.items.find((i) => i.boxId === id);
const route = (k: Kitchen) => k.setup.menu[0]?.steps.map((s) => s.stationId);

describe("kitchen edits", () => {
  it("renames, locks and turns items without touching the input", () => {
    const k = setStandSide(setLocked(renameItem(kitchen, ids.order, "  Till  "), ids.order, true), ids.order, "back");
    expect(item(k, ids.order)).toMatchObject({ name: "Till ", locked: true, standSide: "back" });
    expect(JSON.stringify(kitchen)).toBe(snapshot);
  });

  it("takes a station that stops being a station out of the route and sends its workers home", () => {
    const k = setRole(kitchen, ids.finish, "fixture");
    expect(route(k)).toEqual([ids.order, ids.make]);
    expect(workersAt(k.layout, ids.finish)).toBe(0);
    expect(() => resolveWorld(k.scan, k.setup, k.layout)).not.toThrow();
  });

  it("stops fetching from a box that is no longer storage", () => {
    const k = setRole(kitchen, ids.fridge, "fixture");
    expect(k.setup.menu[0]?.steps[1]?.fetchFrom).toBeUndefined();
    expect(() => resolveWorld(k.scan, k.setup, k.layout)).not.toThrow();
  });

  it("keeps a single pickup", () => {
    const k = setRole(kitchen, ids.sink, "pickup");
    expect(k.setup.pickupId).toBe(ids.sink);
    expect(item(k, ids.pickup)?.role).toBe("fixture");
  });

  it("adds workers with the next free hat colour and removes the last added", () => {
    const four = addWorker(kitchen.layout, ids.make);
    expect(four.workers).toHaveLength(4);
    expect(four.workers[3]).toMatchObject({ color: HAT_COLORS[3], stationId: ids.make });
    expect(new Set(four.workers.map((w) => w.id)).size).toBe(4);
    expect(removeWorker(four, ids.make).workers).toEqual(kitchen.layout.workers);
    expect(removeWorker(kitchen.layout, ids.pickup)).toBe(kitchen.layout);
  });

  it("reorders, removes and adds route stations", () => {
    expect(route(moveRouteStep(kitchen, 0, 1))).toEqual([ids.make, ids.order, ids.finish]);
    expect(route(moveRouteStep(kitchen, 0, -1))).toEqual(route(kitchen));
    expect(route(removeRouteStep(kitchen, 1))).toEqual([ids.order, ids.finish]);
    const removed = removeRouteStep(kitchen, 1);
    expect(route(addRouteStation(removed, ids.make))).toEqual([ids.order, ids.finish, ids.make]);
    expect(route(addRouteStation(kitchen, ids.make))).toEqual(route(kitchen));
  });

  it("toggles a fetch on and off", () => {
    const off = toggleFetch(kitchen, 1, ids.fridge);
    expect(off.setup.menu[0]?.steps[1]?.fetchFrom).toBeUndefined();
    expect(toggleFetch(off, 1, ids.fridge).setup.menu[0]?.steps[1]?.fetchFrom).toEqual([ids.fridge]);
  });

  it("splits a long counter into two stations along its long axis", () => {
    const longScan: Scan = {
      ...kitchen.scan,
      boxes: kitchen.scan.boxes.map((b) => (b.id === ids.order ? { ...b, size: { ...b.size, w: 1.6 } } : b)),
    };
    const long: Kitchen = { ...kitchen, scan: longScan, layout: { ...kitchen.layout, placements: {} } };
    expect(canSplit(longScan.boxes.find((b) => b.id === ids.order))).toBe(true);
    expect(canSplit(kitchen.scan.boxes.find((b) => b.id === ids.order))).toBe(false);
    const result = splitBox(long, ids.order);
    expect(result).not.toBeNull();
    const k = result!.kitchen;
    const a = k.scan.boxes.find((b) => b.id === ids.order)!;
    const b = k.scan.boxes.find((x) => x.id === result!.newId)!;
    expect(a.size.w).toBeCloseTo(0.8);
    expect(b.size.w).toBeCloseTo(0.8);
    expect(b.center.x - a.center.x).toBeCloseTo(0.8, 2);
    expect(route(k)).toEqual([ids.order, result!.newId, ids.make, ids.finish]);
    expect(workersAt(k.layout, result!.newId)).toBe(1);
    expect(item(k, result!.newId)?.name).toBe("Order (till) 2");
    expect(() => resolveWorld(k.scan, k.setup, k.layout)).not.toThrow();
  });

  it("adds a thin floor mark that the model accepts", () => {
    const { kitchen: k, newId } = addFloorMark(kitchen);
    const box = k.scan.boxes.find((b) => b.id === newId)!;
    expect(box.size.h).toBeLessThan(0.06);
    expect(item(k, newId)?.role).toBe("queue");
    expect(() => resolveWorld(k.scan, k.setup, k.layout)).not.toThrow();
    const p = addFloorMark(kitchen, "pickup").kitchen;
    expect(p.setup.pickupId).toMatch(/^mark-/);
    expect(() => resolveWorld(p.scan, p.setup, p.layout)).not.toThrow();
  });
});

describe("which kitchen a run belongs to", () => {
  it("still fits after a floor mark or a split, not after a fresh scan", async () => {
    const { runFitsKitchen } = await import("./kitchen-edit");
    expect(runFitsKitchen(kitchen, addFloorMark(kitchen).kitchen)).toBe(true);
    const fresh = { ...kitchen.scan, boxes: kitchen.scan.boxes.map((b, i) => ({ ...b, id: `new-${i}` })) };
    expect(runFitsKitchen(kitchen, { scan: fresh })).toBe(false);
  });
});
