import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { calibrate, exampleEconomics, reconstructRun, resolveWorld, type Layout, type PositionSample, type Scan, type Setup, type TapEvent } from "../../core";
import { dragArea } from "../scene/model";
import type { ArrangeInput } from "./auto-arrange";
import { addWorker } from "./kitchen-edit";
import { staffChanges, suggest } from "./suggest";

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
const [TILL, MAKE_ID, FINISH] = setup.menu[0]!.steps.map((s) => s.stationId);
// The espresso machine is the slow station, and the kitchen cannot keep up with the example 80 orders an hour.
const economics = { ...exampleEconomics(setup), workS: { [TILL!]: 20, [MAKE_ID!]: 45, [FINISH!]: 25 } };
const input: ArrangeInput = { scan, setup, start: layout, area: dragArea({ scan, setup }), calibration, economics };
const MAKE = "98EA7E27-B557-42A2-9AE3-1C7A609FDAC0";

describe("suggestions", () => {
  it("tries one more worker at each station, and one fewer only where there are two", () => {
    const one = staffChanges(input, layout);
    expect(one.filter((c) => c.staff.delta === -1)).toEqual([]);
    expect(one.filter((c) => c.staff.delta === 1)).toHaveLength(3);
    const two = staffChanges(input, addWorker(layout, MAKE));
    expect(two.filter((c) => c.staff.delta === -1).map((c) => c.staff.stationId)).toEqual([MAKE]);
  });

  it("when the kitchen cannot keep up, suggests moving boxes and a worker at the bottleneck, best first, all better than now", () => {
    const r = suggest(input);
    if (!r.ok) throw new Error(r.reason);
    expect(r.suggestions.length).toBeGreaterThan(0);
    for (const s of r.suggestions) expect(s.gainPerHour).toBeGreaterThan(-0.5);
    const gains = r.suggestions.map((s) => s.score.profitPerHour);
    expect([...gains].sort((a, b) => b - a)).toEqual(gains);
    expect(r.suggestions.some((s) => s.staff?.delta === 1 && s.staff.stationId === MAKE)).toBe(true);
    expect(r.suggestions.some((s) => s.staff === null && s.moved.length > 0)).toBe(true);
  });

  it("does not suggest another worker when wages cost more than the extra sales bring in", () => {
    const r = suggest({ ...input, economics: { ...economics, wagePerHour: 5000 } });
    if (!r.ok) throw new Error(r.reason);
    expect(r.suggestions.some((s) => s.staff?.delta === 1)).toBe(false);
  });

  it("when the kitchen already keeps up, extra workers are never suggested, but a move still is, for shorter waits", () => {
    const r = suggest({ ...input, economics: { ...economics, demandPerHour: 30 } });
    if (!r.ok) throw new Error(r.reason);
    expect(r.suggestions.some((s) => s.staff?.delta === 1)).toBe(false);
    const move = r.suggestions.find((s) => s.staff === null && s.moved.length > 0);
    expect(move).toBeDefined();
    expect(Math.abs(move!.gainPerHour)).toBeLessThan(1);
    expect(move!.score.runTimeS).toBeLessThan(r.before.runTimeS);
  });
});
