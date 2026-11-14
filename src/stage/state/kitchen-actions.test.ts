import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Layout, Scan, Setup } from "../../core";
import { addWorker, renameItem, setRole, workersAt, type Kitchen } from "../app/kitchen-edit";
import { editKitchen } from "./kitchen-actions";
import { kitchen, playLayout } from "./store";

const dir = join(__dirname, "../../../fixtures/counter-a");
const read = <T>(f: string) => JSON.parse(readFileSync(join(dir, f), "utf8")) as T;
const fixture: Kitchen = { scan: read<Scan>("scan.json"), setup: read<Setup>("setup.json"), layout: read<Layout>("layout.json") };
const ids = {
  order: "61A93A22-761D-47DF-BC5F-5EB3A7D8334A",
  finish: "9886D544-4186-4B47-978D-7D032CCECDEA",
  fridge: "65E69210-5EED-4D93-9F34-955C39B9EDBF",
};

describe("editKitchen with a judge layout of its own", () => {
  it("re-applies the edit to the judge's layout: the station's workers go, the judge's moves stay", () => {
    const placed = fixture.layout.placements[ids.fridge]!;
    const judge: Layout = { ...fixture.layout, placements: { ...fixture.layout.placements, [ids.fridge]: { ...placed, x: placed.x + 1 } } };
    kitchen.value = fixture;
    playLayout.value = judge;
    editKitchen((x) => setRole(x, ids.finish, "fixture"));
    expect(playLayout.value).not.toBe(fixture.layout);
    expect(workersAt(playLayout.value!, ids.finish)).toBe(0);
    expect(playLayout.value!.placements[ids.fridge]!.x).toBeCloseTo(placed.x + 1);
  });

  it("takes the new layout when the judge has none of their own", () => {
    kitchen.value = fixture;
    playLayout.value = fixture.layout;
    editKitchen((x) => setRole(x, ids.finish, "fixture"));
    expect(playLayout.value).toBe(kitchen.value!.layout);
    expect(workersAt(playLayout.value!, ids.finish)).toBe(0);
  });

  it("leaves the judge's layout alone for a setup-only change like a rename", () => {
    const judge = addWorker(fixture.layout, ids.order);
    kitchen.value = fixture;
    playLayout.value = judge;
    editKitchen((x) => renameItem(x, ids.order, "Till"));
    expect(playLayout.value).toBe(judge);
  });
});
