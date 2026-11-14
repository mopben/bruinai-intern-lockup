import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exampleEconomics, type Economics, type Setup } from "../../core";
import { applyCosts, costsFileOf, parseCosts, serialiseCosts } from "./costs-file";

const setup = JSON.parse(readFileSync(join(__dirname, "../../../fixtures/counter-a/setup.json"), "utf8")) as Setup;
const first = setup.menu[0];
if (!first) throw new Error("fixture has no menu");

const econ: Economics = {
  ...exampleEconomics(setup),
  currency: "€",
  menu: { ...exampleEconomics(setup).menu, [first.id]: { price: 6.25, ingredients: 1.75 } },
  wagePerHour: 21,
  wageByWorker: { "worker-1": 24 },
  electricityPerHour: 2,
  otherPerHour: 15,
  demandPerHour: 80,
};

describe("prices-and-costs file", () => {
  it("round-trips every number through export and import", () => {
    const text = serialiseCosts(costsFileOf(econ, setup, new Date("2026-01-01T00:00:00Z")));
    const parsed = parseCosts(text);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.value.menu[first.id]).toEqual({ name: first.name, price: 6.25, ingredients: 1.75 });
    const applied = applyCosts(parsed.value, setup);
    expect(applied.missing).toEqual([]);
    expect(applied.matched).toBe(setup.menu.length);
    expect(applied.economics).toEqual({
      currency: "€",
      menu: Object.fromEntries(Object.entries(econ.menu).map(([id, p]) => [id, { price: p.price, ingredients: p.ingredients }])),
      wagePerHour: 21,
      wageByWorker: { "worker-1": 24 },
      electricityPerHour: 2,
      otherPerHour: 15,
      demandPerHour: 80,
    });
  });

  it("matches menu items by name when the ids differ, and lists the ones it cannot find", () => {
    const file = costsFileOf(econ, setup);
    const renamed = { ...file, menu: { "other-id": { name: first.name.toUpperCase(), price: 9, ingredients: 2 } } };
    const applied = applyCosts(renamed, setup);
    expect(applied.economics.menu?.[first.id]).toEqual({ price: 9, ingredients: 2 });
    expect(applied.missing).toEqual(setup.menu.slice(1).map((m) => m.name));
  });

  it("refuses files that are not JSON, the wrong format, or have bad numbers", () => {
    expect(parseCosts("nope")).toMatchObject({ ok: false, error: expect.stringContaining("not JSON") });
    expect(parseCosts(JSON.stringify({ format: "dryrun.camera-calibration" }))).toMatchObject({ ok: false });
    const bad = { ...costsFileOf(econ, setup), wagePerHour: -3 };
    expect(parseCosts(JSON.stringify(bad))).toMatchObject({ ok: false, error: expect.stringContaining("wagePerHour") });
  });
});
