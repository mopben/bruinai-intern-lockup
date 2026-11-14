import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Layout, Scan, Setup } from "../../core";
import { resolveWorld } from "../../core";
import { setupSchema } from "../../inputs/schemas";
import type { Kitchen } from "./kitchen-edit";
import { createRecipe, setRecipeQuantity, updateRecipe, withDemoRecipes } from "./recipes";

const read = <T>(name: string) => JSON.parse(readFileSync(join(__dirname, "../../../fixtures/counter-a", name), "utf8")) as T;
const k: Kitchen = { scan: read<Scan>("scan.json"), setup: read<Setup>("setup.json"), layout: read<Layout>("layout.json") };

describe("order recipes", () => {
  it("seeds demo recipes without rewriting the recording's menu item or schedule", () => {
    const setup = withDemoRecipes(k.setup);
    expect(setup.menu.map((m) => m.name)).toEqual(["Latte", "Espresso", "Cappuccino"]);
    expect(setup.menu[0]).toBe(k.setup.menu[0]);
    expect(setup.schedule).toBe(k.setup.schedule);
    expect(withDemoRecipes(setup)).toBe(setup);
    expect(setupSchema.parse(setup).menu[1]?.steps[1]?.workSeconds).toBe(10);
    expect(() => resolveWorld(k.scan, setup, k.layout)).not.toThrow();
  });
  it("creates distinct orders and edits only the selected recipe", () => {
    const a = createRecipe(k);
    const b = createRecipe(a.kitchen);
    expect(a.id).not.toBe(b.id);
    const changed = updateRecipe(b.kitchen, a.id, { name: "Mocha", steps: [{ stationId: k.setup.menu[0]!.steps[1]!.stationId, workSeconds: 12 }] });
    expect(changed.setup.menu.find((m) => m.id === a.id)?.name).toBe("Mocha");
    expect(changed.setup.menu[0]).toBe(k.setup.menu[0]);
    expect(() => resolveWorld(changed.scan, changed.setup, changed.layout)).not.toThrow();
  });
  it("adds and removes simulation quantities with unique IDs and valid release times", () => {
    const seeded = { ...k, setup: withDemoRecipes(k.setup) };
    const added = setRecipeQuantity(seeded, "espresso", 3);
    expect(added.setup.schedule.orders.filter((o) => o.itemId === "espresso")).toHaveLength(3);
    expect(new Set(added.setup.schedule.orders.map((o) => o.orderId)).size).toBe(13);
    expect(added.setup.schedule.orders.slice(0, 10)).toEqual(k.setup.schedule.orders);
    expect(setRecipeQuantity(added, "espresso", 0).setup.schedule.orders).toEqual(k.setup.schedule.orders);
    expect(() => resolveWorld(added.scan, added.setup, added.layout)).not.toThrow();
  });
});
