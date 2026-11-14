import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseLayout, parseScan, parseSetup, unwrap } from "../inputs/parse";
import { insideBounds, kitchenKey, kitchenView, type Kitchen } from "./kitchen";

const dir = new URL("../../fixtures/counter-a/", import.meta.url);
const read = (f: string) => readFileSync(new URL(f, dir), "utf8");
export const counterA: Kitchen = {
  scan: unwrap(parseScan(read("scan.json"))),
  setup: unwrap(parseSetup(read("setup.json"))),
  layout: unwrap(parseLayout(read("layout.json"))),
};

describe("kitchenView", () => {
  it("lists named boxes, floor and top corners, wall ends and bounds", () => {
    const v = kitchenView(counterA);
    if (!v.ok) throw new Error(v.error);
    const names = v.value.boxes.map((b) => b.name);
    expect(names).toContain("Espresso machine");
    expect(names).not.toContain("chair");
    const make = v.value.refs.filter((r) => r.label.startsWith("Espresso machine"));
    expect(make.filter((r) => r.kind === "floor")).toHaveLength(4);
    expect(make.filter((r) => r.kind === "top").every((r) => Math.abs(r.world.y - 0.9273) < 1e-9)).toBe(true);
    // The queue floor mark is 2 cm high: floor corners only.
    const queue = v.value.boxes.find((b) => b.role === "queue")!;
    expect(v.value.refs.filter((r) => r.id.startsWith(queue.id) && r.kind === "top")).toHaveLength(0);
    expect(v.value.refs.filter((r) => r.id.startsWith("wall-end")).length).toBe(3);
    expect(v.value.bounds.minX).toBeLessThan(0);
    expect(v.value.bounds.maxX).toBeGreaterThan(4.4);
    expect(insideBounds(v.value.bounds, { x: 2, z: 1 }, 0)).toBe(true);
    expect(v.value.stands.red!.z).toBeCloseTo(0.3437 + 0.6032 / 2 + 0.35, 2);
    expect(insideBounds(v.value.bounds, { x: 9, z: 1 }, 0.5)).toBe(false);
  });

  it("keys calibrations by scan, not by layout", () => {
    const moved: Kitchen = { ...counterA, layout: { ...counterA.layout, placements: {} } };
    expect(kitchenKey(moved.scan)).toBe(kitchenKey(counterA.scan));
    expect(kitchenKey({ ...counterA.scan, capturedAt: "2026-01-01T00:00:00Z" })).not.toBe(kitchenKey(counterA.scan));
  });

  it("explains a broken kitchen instead of throwing", () => {
    const broken: Kitchen = { ...counterA, setup: { ...counterA.setup, pickupId: "nope" } };
    const v = kitchenView(broken);
    expect(v.ok).toBe(false);
  });
});
