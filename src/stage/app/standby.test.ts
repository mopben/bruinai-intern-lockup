import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseLayout, parseScan, parseSetup, unwrap } from "../../inputs";
import { buildStarterKitchen } from "./starter-setup";
import { standbyFits } from "./standby";

const dir = (id: string) => resolve(__dirname, "../../../fixtures", id);
const read = (id: string, f: string) => readFileSync(resolve(dir(id), f), "utf8");
const run = (id: string) => ({
  scan: unwrap(parseScan(read(id, "scan.json"))),
  setup: unwrap(parseSetup(read(id, "setup.json"))),
  layout: unwrap(parseLayout(read(id, "layout.json"))),
});

describe("a recording standing by for a live run", () => {
  const a = run("counter-a");
  it("fits the kitchen it was recorded in", () => {
    expect(standbyFits(a, a)).toBe(true);
  });
  it("fits the changed layout of the same kitchen when it knows every worker", () => {
    const c = run("counter-c-fourth-worker");
    expect(standbyFits(c, { ...a, layout: c.layout })).toBe(true);
    // The fourth worker is not in the original layout: splicing their positions would invent a person.
    expect(standbyFits(c, a)).toBe(false);
  });
  it("does not fit a phone scan of the same counter with the starter setup (other ids)", () => {
    const starter = buildStarterKitchen(a.scan);
    expect(standbyFits(a, { scan: a.scan, setup: starter.setup, layout: starter.layout })).toBe(false);
  });
});
