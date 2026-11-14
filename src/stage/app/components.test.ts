import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveWorld, type Layout, type Scan, type Setup } from "../../core";
import type { Kitchen } from "./kitchen-edit";
import { addComponent } from "./components";

const read = <T>(file: string) => JSON.parse(readFileSync(join(__dirname, "../../../fixtures/counter-a", file), "utf8")) as T;
const k: Kitchen = { scan: read<Scan>("scan.json"), setup: read<Setup>("setup.json"), layout: read<Layout>("layout.json") };
const point = { x: 2.2, z: 1.2 };

describe("adding kitchen components", () => {
  it("adds a named, movable station at the clicked square and leaves recipes intact", () => {
    const result = addComponent(k, "espresso", point)!;
    expect(result).not.toBeNull();
    expect(result.kitchen.scan.boxes.find((b) => b.id === result.id)?.center).toMatchObject({ x: 2.5, z: 1.5 });
    expect(result.kitchen.setup.items.find((s) => s.boxId === result.id)).toMatchObject({ name: "Espresso machine", role: "station", locked: false });
    expect(result.kitchen.setup.menu).toBe(k.setup.menu);
    expect(() => resolveWorld(result.kitchen.scan, result.kitchen.setup, result.kitchen.layout)).not.toThrow();
    expect(k.scan.boxes.some((b) => b.id === result.id)).toBe(false);
  });
  it("rejects occupied squares, out of bounds positions and invalid components", () => {
    const result = addComponent(k, "espresso", point)!;
    expect(addComponent(result.kitchen, "fridge", point)).toBeNull();
    expect(addComponent(k, "fridge", { x: 100, z: 100 })).toBeNull();
    expect(addComponent(k, "unknown", point)).toBeNull();
    expect(addComponent(k, "fridge", { x: NaN, z: 0 })).toBeNull();
  });
  it("checks the edited layout when a component has moved into the square", () => {
    const result = addComponent(k, "counter", point)!;
    const moved = { ...k.layout, placements: { ...k.layout.placements, [k.scan.boxes.find((b) => k.setup.items.some((s) => s.boxId === b.id && s.role === "station"))!.id]: { x: 2.5, z: 1.5, yaw: 0 } } };
    expect(addComponent(k, "espresso", point, moved)).toBeNull();
    const next = addComponent(result.kitchen, "fridge", { x: 1.2, z: 1.2 })!;
    expect(next.id).not.toBe(result.id);
  });
});
