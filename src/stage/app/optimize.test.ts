import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildPathTable, calibrate, exampleEconomics, reconstructRun, resolveWorld, walkingPerOrder, type Layout, type PositionSample, type Scan, type Setup, type TapEvent } from "../../core";
import { CONTACT_GAP_M, overlaps } from "../scene/collision";
import { dragArea, footprintRect } from "../scene/model";
import { arrange, compareScores, movableIds, standProblems, type ArrangeInput } from "./auto-arrange";
import { addWorker, setLocked, workersAt } from "./kitchen-edit";
import { MAX_PER_STATION, optimize, optimizeSteps, routeStations, scoreLayout, staffEveryStation, staffNeighbours } from "./optimize";

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
const economics = exampleEconomics(setup);
const area = dragArea({ scan, setup });
const input: ArrangeInput = Object.freeze({ scan, setup, start: layout, area, calibration, economics });
const ORDER = "61A93A22-761D-47DF-BC5F-5EB3A7D8334A";
const MAKE = "98EA7E27-B557-42A2-9AE3-1C7A609FDAC0";
const SINK = "CDE6CBCE-51B0-43F3-8352-3709255BFE67";
const FRIDGE = "65E69210-5EED-4D93-9F34-955C39B9EDBF";

/** Each full search takes a few seconds. */
const SLOW = 60_000;

const ok = (r: ReturnType<typeof optimize>) => {
  if (!r.ok) throw new Error(r.reason);
  return r;
};
const result = ok(optimize(input));
/** More orders than three people can make however the boxes stand. */
const rush = { ...input, economics: { ...economics, demandPerHour: 3000 } };
const rushed = ok(optimize(rush));

describe("optimize: the team", { timeout: SLOW }, () => {
  it("tries one more, one fewer and one moved, and never empties a station on a recipe", () => {
    const one = staffNeighbours(input, layout);
    expect(one.filter((l) => l.workers.length === 4)).toHaveLength(3);
    expect(one.filter((l) => l.workers.length < 3)).toEqual([]);
    const two = staffNeighbours(input, addWorker(layout, MAKE));
    expect(two.filter((l) => l.workers.length === 3).map((l) => workersAt(l, MAKE))).toEqual([1]);
    expect(two.filter((l) => l.workers.length === 4 && workersAt(l, MAKE) === 1)).toHaveLength(2);
    for (const l of [...one, ...two]) for (const id of routeStations(input)) expect(workersAt(l, id)).toBeGreaterThan(0);
  });

  it("adds people while the extra sales beat their wages, and keeps everyone already there", () => {
    expect(rushed.hired.length).toBeGreaterThan(0);
    expect(rushed.removed).toEqual([]);
    expect(rushed.layout.workers.length).toBe(layout.workers.length + rushed.hired.length);
    for (const id of routeStations(input)) expect(workersAt(rushed.layout, id)).toBeLessThanOrEqual(MAX_PER_STATION);
    // No team one step away is better in the arrangement it chose.
    for (const l of staffNeighbours(rush, rushed.layout)) {
      const s = scoreLayout(rush, l);
      if (s) expect(compareScores(s, rushed.after)).toBeGreaterThanOrEqual(0);
    }
  });

  it("adds nobody when wages cost more than the extra sales bring in", () => {
    const r = ok(optimize({ ...rush, economics: { ...rush.economics, wagePerHour: 5000 } }));
    expect(r.hired).toEqual([]);
    expect(r.layout.workers.length).toBe(3);
  });

  it("takes away a worker the kitchen sells as much without, the best paid first", () => {
    const extra = addWorker(addWorker(layout, ORDER), ORDER);
    const paid = { ...economics, demandPerHour: 60, workerWages: { w4: 30, w5: 12 } };
    const r = ok(optimize({ ...input, start: extra, economics: paid }));
    // One person is enough at the till: of the three there (default wage 18, w4 on 30, w5 on 12) the cheapest stays.
    expect(r.removed.map((w) => w.id).sort()).toEqual(["red", "w4"]);
    expect(workersAt(r.layout, ORDER)).toBe(1);
    expect(r.layout.workers.length).toBe(3);
    expect(r.after.profitPerHour).toBeGreaterThan((r.before?.profitPerHour ?? Infinity) + 40);
  });

  it("moves a spare worker to the bottleneck instead of letting one go and hiring another", () => {
    const spare = addWorker(layout, ORDER);
    const r = ok(optimize({ ...rush, start: spare }));
    const names = new Set(r.layout.workers.map((w) => w.id));
    for (const w of spare.workers) expect(names.has(w.id)).toBe(true);
    expect(r.removed).toEqual([]);
  });

  it("staffs a station that has nobody, so a kitchen that could not run can", () => {
    const empty: Layout = { ...layout, workers: layout.workers.filter((w) => w.stationId !== MAKE) };
    expect(scoreLayout(input, empty)).toBeNull();
    expect(workersAt(staffEveryStation(input, empty), MAKE)).toBe(1);
    const r = ok(optimize({ ...input, start: empty }));
    expect(r.before).toBeNull();
    expect(r.changed).toBe(true);
    expect(workersAt(r.layout, MAKE)).toBeGreaterThan(0);
  });
});

describe("optimize: the equipment and the room", { timeout: SLOW }, () => {
  it("is at least as good as moving the boxes alone and as any one staffing change", () => {
    expect(result.changed).toBe(true);
    if (!result.before) throw new Error("the start should score");
    expect(compareScores(result.after, result.before)).toBeLessThan(0);
    const moved = arrange(input);
    if (!moved.ok) throw new Error(moved.reason);
    expect(compareScores(result.after, moved.after)).toBeLessThanOrEqual(0);
    for (const l of staffNeighbours(input, layout)) {
      const s = scoreLayout(input, l);
      if (s) expect(compareScores(result.after, s)).toBeLessThanOrEqual(0);
    }
  });

  it("keeps the equipment it was given: nothing added or removed, locked and unreal boxes where they were", () => {
    for (const r of [result, rushed]) {
      expect(Object.keys(r.layout.placements).sort()).toEqual(Object.keys(layout.placements).sort());
      const movable = movableIds(scan, setup);
      for (const id of r.moved) expect(movable).toContain(id);
      for (const b of scan.boxes) if (!movable.includes(b.id)) expect(r.layout.placements[b.id]).toEqual(layout.placements[b.id]);
      expect(r.layout.placements[MAKE]).toEqual(layout.placements[MAKE]);
      expect(r.layout.placements[SINK]).toEqual(layout.placements[SINK]);
    }
  });

  it("does not move a box the owner locks", () => {
    const locked = setLocked({ scan, setup, layout }, FRIDGE, true).setup;
    const r = ok(optimize({ ...input, setup: locked }));
    expect(r.layout.placements[FRIDGE]).toEqual(layout.placements[FRIDGE]);
    expect(r.moved).not.toContain(FRIDGE);
  });

  it("still optimizes the team when every box is locked", () => {
    let k = { scan, setup, layout };
    for (const id of movableIds(scan, setup)) k = setLocked(k, id, true);
    const r = ok(optimize({ ...rush, setup: k.setup }));
    expect(r.moved).toEqual([]);
    expect(r.layout.placements).toEqual(layout.placements);
    expect(r.hired.length).toBeGreaterThan(0);
  });

  it("leaves a kitchen people can work in: inside the room, no overlaps, every walk open, every spot free", () => {
    for (const r of [result, rushed]) {
      const roles = new Map(setup.items.map((i) => [i.boxId, i.role] as const));
      const rects = scan.boxes
        .filter((b) => !["ignore", "queue"].includes(roles.get(b.id) ?? "fixture"))
        .map((b) => {
          const p = r.layout.placements[b.id] ?? { x: b.center.x, z: b.center.z, yaw: b.yaw };
          return { id: b.id, r: footprintRect(b.size, p.x, p.z, p.yaw) };
        });
      for (const id of r.moved) {
        const me = rects.find((x) => x.id === id);
        if (!me) throw new Error("moved box not found");
        expect(me.r.minX).toBeGreaterThanOrEqual(area.minX - 1e-6);
        expect(me.r.maxX).toBeLessThanOrEqual(area.maxX + 1e-6);
        expect(me.r.minZ).toBeGreaterThanOrEqual(area.minZ - 1e-6);
        expect(me.r.maxZ).toBeLessThanOrEqual(area.maxZ + 1e-6);
        for (const o of rects) if (o.id !== id) expect(overlaps(me.r, o.r, CONTACT_GAP_M - 1e-9)).toBe(false);
      }
      const world = resolveWorld(scan, setup, r.layout);
      expect(walkingPerOrder(world, buildPathTable(world)).anyBlocked).toBe(false);
      expect([...standProblems(world, area)]).toEqual([]);
    }
  });

  it("says nothing changes when run on its own answer, handing back the same layout", () => {
    const again = ok(optimize({ ...input, start: result.layout }));
    expect(again.changed).toBe(false);
    expect(again.layout).toBe(result.layout);
    expect(again.moved).toEqual([]);
  });

  it("is repeatable", () => {
    expect(optimize(input)).toEqual(result);
  });

  it("yields often, so the stage can keep drawing", () => {
    const g = optimizeSteps(input);
    let yields = 0;
    let longest = 0;
    let last = -1;
    let t = performance.now();
    let r = g.next();
    while (!r.done) {
      const now = performance.now();
      longest = Math.max(longest, now - t);
      t = now;
      yields += 1;
      expect(r.value.fraction).toBeGreaterThanOrEqual(last);
      expect(r.value.fraction).toBeLessThan(1);
      last = r.value.fraction;
      r = g.next();
    }
    expect(yields).toBeGreaterThan(100);
    expect(longest).toBeLessThan(150);
  });
});

describe("auto-arrange from another starting arrangement", () => {
  it("reports moves against the owner's layout, not the arrangement it started from", () => {
    const r = arrange({ ...input, start: result.layout, home: layout });
    if (!r.ok) throw new Error(r.reason);
    expect([...r.moved].sort()).toEqual([...result.moved].sort());
  });
});
