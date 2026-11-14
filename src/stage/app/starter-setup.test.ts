import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveWorld, type Scan, type ScanBox } from "../../core";
import { HAT_COLORS, buildStarterKitchen, guessStandSide } from "./starter-setup";

const scanA = JSON.parse(readFileSync(join(__dirname, "../../../fixtures/counter-a/scan.json"), "utf8")) as Scan;
const id = (prefix: string) => scanA.boxes.find((b) => b.id.startsWith(prefix))?.id as string;

function box(over: Partial<ScanBox> & { id: string; category: string; x: number; z: number }): ScanBox {
  return {
    id: over.id,
    category: over.category,
    center: { x: over.x, y: 0.45, z: over.z },
    size: over.size ?? { w: 0.8, h: 0.9, d: 0.6 },
    yaw: over.yaw ?? 0,
    ...(over.confidence ? { confidence: over.confidence } : {}),
  };
}

const bare = (boxes: readonly ScanBox[]): Scan => ({ ...scanA, boxes });

describe("starter setup from a fresh scan", () => {
  const { setup, layout, notes } = buildStarterKitchen(scanA);
  const item = (prefix: string) => setup.items.find((i) => i.boxId === id(prefix));

  it("guesses roles from the scanner's categories", () => {
    expect(item("CDE6")).toMatchObject({ role: "fixture", locked: true, name: "Sink" });
    expect(item("65E6")).toMatchObject({ role: "storage", locked: false });
    expect(item("429D")?.role).toBe("ignore");
    expect(item("9314")?.role).toBe("queue");
    expect(setup.pickupId).toBe(id("81C9"));
  });

  it("makes the counters stations, left to right, and the last one the pickup", () => {
    const route = setup.menu[0]?.steps.map((s) => s.stationId);
    expect(route).toEqual([id("61A9"), id("98EA"), id("9886")]);
    expect(setup.menu[0]?.steps.map((s) => s.fetchFrom ?? [])).toEqual([[], [id("65E6")], []]);
    expect([item("61A9")?.name, item("98EA")?.name, item("9886")?.name]).toEqual(["Order", "Make", "Finish"]);
  });

  it("puts one worker at each station in the standard hat colours", () => {
    expect(layout.workers.map((w) => w.color)).toEqual(HAT_COLORS.slice(0, 3));
    expect(layout.workers.map((w) => w.stationId)).toEqual([id("61A9"), id("98EA"), id("9886")]);
  });

  it("schedules 10 orders about every 6 s, the same every time", () => {
    const ts = setup.schedule.orders.map((o) => o.t);
    expect(ts).toHaveLength(10);
    ts.slice(1).forEach((t, i) => {
      const gap = t - (ts[i] as number);
      expect(gap).toBeGreaterThan(4.5);
      expect(gap).toBeLessThan(7.5);
    });
    expect(buildStarterKitchen(scanA).setup.schedule).toEqual(setup.schedule);
  });

  it("produces a kitchen the model accepts", () => {
    expect(() => resolveWorld(scanA, setup, layout)).not.toThrow();
    expect(notes).toEqual([]);
  });

  it("faces each stand side toward the middle of the room", () => {
    expect(setup.items.filter((i) => i.role === "station").every((i) => i.standSide === "front")).toBe(true);
    const centre = { x: 0, z: 0 };
    expect(guessStandSide(box({ id: "a", category: "table", x: 0, z: -2 }), centre)).toBe("front");
    expect(guessStandSide(box({ id: "a", category: "table", x: 0, z: 2 }), centre)).toBe("back");
    expect(guessStandSide(box({ id: "a", category: "table", x: 2, z: 0 }), centre)).toBe("left");
    expect(guessStandSide(box({ id: "a", category: "table", x: -2, z: 0 }), centre)).toBe("right");
  });

  it("says plainly when there are too few counters for a pickup", () => {
    const one = buildStarterKitchen(bare([box({ id: "t1", category: "table", x: 0, z: 0 })]));
    expect(one.notes.join(" ")).toMatch(/pickup/i);
    expect(one.setup.items[0]?.role).toBe("station");
  });

  it("does not fetch from storage when there is none", () => {
    const k = buildStarterKitchen(
      bare([0, 1, 2].map((i) => box({ id: `t${i}`, category: "table", x: i, z: 0 }))),
    );
    expect(k.setup.menu[0]?.steps.every((s) => (s.fetchFrom ?? []).length === 0)).toBe(true);
    expect(k.setup.pickupId).toBe("t2");
  });
});
