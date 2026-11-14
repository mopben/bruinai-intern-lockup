import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildPathTable, calibrate, exampleEconomics, predict, profitOf, reconstructRun, resolveWorld, walkingPerOrder, type Layout, type PositionSample, type Scan, type Setup, type TapEvent } from "../../core";
import { CONTACT_GAP_M, overlaps } from "../scene/collision";
import { dragArea, footprintRect } from "../scene/model";
import { arrange, arrangeSteps, compareScores, movableIds, standProblems, type ArrangeInput } from "./auto-arrange";
import { setLocked } from "./kitchen-edit";

const dir = join(__dirname, "../../../fixtures/counter-a");
const read = <T>(f: string) => JSON.parse(readFileSync(join(dir, f), "utf8")) as T;
const lines = <T>(f: string) =>
  readFileSync(join(dir, f), "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as { type: string })
    .filter((l) => l.type !== "header") as T[];

const scan = read<Scan>("scan.json");
const setup = read<Setup>("setup.json");
const layout = read<Layout>("layout.json");
const calibration = calibrate(resolveWorld(scan, setup, layout), reconstructRun(setup, lines<TapEvent>("taps.jsonl")), lines<PositionSample>("positions.jsonl"));
const area = dragArea({ scan, setup });
const economics = exampleEconomics(setup);
const input: ArrangeInput = Object.freeze({ scan, setup, start: layout, area, calibration, economics });

const ids = {
  order: "61A93A22-761D-47DF-BC5F-5EB3A7D8334A",
  make: "98EA7E27-B557-42A2-9AE3-1C7A609FDAC0",
  finish: "9886D544-4186-4B47-978D-7D032CCECDEA",
  fridge: "65E69210-5EED-4D93-9F34-955C39B9EDBF",
  pickup: "81C9EBC2-31C1-4C98-879A-0EAB5851BF60",
  sink: "CDE6CBCE-51B0-43F3-8352-3709255BFE67",
  stool: "429D9670-6776-4ABA-8B0D-85FD53F980D1",
  queue: "93141A88-524E-461D-9331-FF0DC977BB94",
};

const placement = (l: Layout, id: string) => l.placements[id];
const result = arrange(input);

describe("auto-arrange", () => {
  it("moves only unlocked boxes, never floor marks or scan noise", () => {
    expect([...movableIds(scan, setup)].sort()).toEqual([ids.order, ids.finish, ids.fridge, ids.pickup].sort());
    if (!result.ok) throw new Error(result.reason);
    for (const id of [ids.make, ids.sink, ids.stool, ids.queue]) expect(placement(result.layout, id)).toEqual(placement(layout, id));
    for (const id of result.moved) expect(movableIds(scan, setup)).toContain(id);
  });

  it("finds a more profitable layout whose run finishes sooner, by the stage's own numbers too", () => {
    if (!result.ok) throw new Error(result.reason);
    expect(result.moved.length).toBeGreaterThan(0);
    expect(compareScores(result.after, result.before)).toBeLessThan(0);
    // Checked with the stage's prediction (seed 1, 200 runs), not the search's own draws.
    const before = predict(resolveWorld(scan, setup, layout), calibration);
    const after = predict(resolveWorld(scan, setup, result.layout), calibration);
    expect(after.lastFinish.p50).toBeLessThan(before.lastFinish.p50 - 1);
    expect(after.meanOrderTime.p50).toBeLessThan(before.meanOrderTime.p50);
    const moneyBefore = profitOf(resolveWorld(scan, setup, layout), calibration, economics);
    const moneyAfter = profitOf(resolveWorld(scan, setup, result.layout), calibration, economics);
    expect(moneyAfter.profitPerHour.p50).toBeGreaterThan(moneyBefore.profitPerHour.p50);
  });

  it("keeps the workers and their stations", () => {
    if (!result.ok) throw new Error(result.reason);
    expect(result.layout.workers).toEqual(layout.workers);
  });

  it("leaves a kitchen people can work in: inside the room, no overlaps, every walk open, every spot free", () => {
    if (!result.ok) throw new Error(result.reason);
    const roles = new Map(setup.items.map((i) => [i.boxId, i.role] as const));
    const solid = scan.boxes.filter((b) => !["ignore", "queue"].includes(roles.get(b.id) ?? "fixture"));
    const rects = solid.map((b) => {
      const p = result.layout.placements[b.id] ?? { x: b.center.x, z: b.center.z, yaw: b.yaw };
      return { id: b.id, r: footprintRect(b.size, p.x, p.z, p.yaw) };
    });
    for (const id of result.moved) {
      const me = rects.find((x) => x.id === id);
      if (!me) throw new Error("moved box not found");
      expect(me.r.minX).toBeGreaterThanOrEqual(area.minX - 1e-6);
      expect(me.r.maxX).toBeLessThanOrEqual(area.maxX + 1e-6);
      expect(me.r.minZ).toBeGreaterThanOrEqual(area.minZ - 1e-6);
      expect(me.r.maxZ).toBeLessThanOrEqual(area.maxZ + 1e-6);
      for (const o of rects) if (o.id !== id) expect(overlaps(me.r, o.r, CONTACT_GAP_M - 1e-9)).toBe(false);
    }
    const world = resolveWorld(scan, setup, result.layout);
    expect(walkingPerOrder(world, buildPathTable(world)).anyBlocked).toBe(false);
    expect([...standProblems(world, area)]).toEqual([]);
  });

  it("does not move a box that is locked", () => {
    const locked = setLocked({ scan, setup, layout }, ids.fridge, true).setup;
    const r = arrange({ ...input, setup: locked });
    if (!r.ok) throw new Error(r.reason);
    expect(placement(r.layout, ids.fridge)).toEqual(placement(layout, ids.fridge));
    expect(r.moved).not.toContain(ids.fridge);
  });

  it("says so when everything is locked", () => {
    let k = { scan, setup, layout };
    for (const id of movableIds(scan, setup)) k = setLocked(k, id, true);
    const r = arrange({ ...input, setup: k.setup });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/locked/);
  });

  it("is repeatable and gets no better when run again on its own answer", () => {
    if (!result.ok) throw new Error(result.reason);
    const again = arrange(input);
    expect(again).toEqual(result);
    const twice = arrange({ ...input, start: result.layout });
    if (!twice.ok) throw new Error(twice.reason);
    expect(compareScores(twice.after, result.after)).toBeLessThanOrEqual(0);
  });

  it("yields often, so the stage can keep drawing", () => {
    const g = arrangeSteps(input);
    let yields = 0;
    let longest = 0;
    let t = performance.now();
    let r = g.next();
    while (!r.done) {
      const now = performance.now();
      longest = Math.max(longest, now - t);
      t = now;
      yields += 1;
      expect(r.value.fraction).toBeGreaterThanOrEqual(0);
      expect(r.value.fraction).toBeLessThan(1);
      r = g.next();
    }
    expect(yields).toBeGreaterThan(50);
    expect(longest).toBeLessThan(100);
  });
});
