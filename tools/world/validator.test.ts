import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateRun } from "./generate";
import { RUNS } from "./runs";
import { formatReport, validateRunFiles, validateRunFolder, type RunFileName } from "./validator";

const base = generateRun(RUNS[0] as (typeof RUNS)[number]);
const good = base.files as Record<RunFileName, string>;
const MAKE = base.ids.make;
const ORDER = base.ids.order;

const withFile = (name: RunFileName, text: string | undefined): Partial<Record<RunFileName, string>> => {
  const copy: Partial<Record<RunFileName, string>> = { ...good };
  if (text === undefined) delete copy[name];
  else copy[name] = text;
  return copy;
};
const edit = (name: RunFileName, f: (lines: string[]) => string[]): Partial<Record<RunFileName, string>> =>
  withFile(name, f(good[name].split("\n")).join("\n"));
const messages = (files: Partial<Record<RunFileName, string>>) => {
  const r = validateRunFiles(files, "counter-a");
  return { errors: r.errors.map((i) => `${i.file}${i.line ? `:${i.line}` : ""} ${i.message}`), warnings: r.warnings.map((i) => `${i.file}${i.line ? `:${i.line}` : ""} ${i.message}`) };
};
const lineOf = (name: RunFileName, needle: string): number => good[name].split("\n").findIndex((l) => l.includes(needle)) + 1;

describe("validator", () => {
  it("accepts a good folder and describes it", () => {
    const r = validateRunFiles(good, "counter-a");
    expect(r.errors).toEqual([]);
    expect(r.facts).toMatch(/10 orders, 88\.\d s, 3 workers tracked/);
    expect(formatReport("fixtures/counter-a", r)).toMatch(/^OK: fixtures\/counter-a can be loaded/);
  });

  it("names a missing file and lists what a folder holds", () => {
    const { errors } = messages(withFile("positions.jsonl", undefined));
    expect(errors).toEqual(["positions.jsonl is missing. A run folder holds run.json, scan.json, setup.json, layout.json, taps.jsonl, positions.jsonl"]);
  });

  it("reports broken JSON with a hint", () => {
    const { errors } = messages(withFile("run.json", '{ "id": "x", }'));
    expect(errors[0]).toMatch(/^run\.json is not valid JSON: .*\(a trailing comma or a missing quote\?\)/);
  });

  it("names the field, the line and the rule for a bad tap", () => {
    const line = lineOf("taps.jsonl", '"step":1');
    const { errors } = messages(edit("taps.jsonl", (ls) => ls.map((l, i) => (i === line - 1 ? l.replace('"step":1', '"step":1.5') : l))));
    expect(errors).toContain(`taps.jsonl:${line} field "step" must be a whole number (0 for the first step)`);
  });

  it("says a field is missing rather than the wrong type", () => {
    const { errors } = messages(edit("taps.jsonl", (ls) => ls.map((l) => (l.includes('"orderId":"o3","step":0') ? l.replace(/"t":[\d.]+,/, "") : l))));
    expect(errors.some((e) => /field "t" is missing$/.test(e))).toBe(true);
  });

  it("warns about an unknown field (a likely typo)", () => {
    const { errors, warnings } = messages(edit("setup.json", (ls) => ls.map((l) => l.replace('"standSide"', '"standside"'))));
    expect(errors).toEqual([]);
    expect(warnings[0]).toMatch(/^setup\.json field "items\[0\]" has unknown field "standside"; it is ignored \(check the spelling\)/);
  });

  it("catches a tap at the wrong station, naming both", () => {
    const line = lineOf("taps.jsonl", '"orderId":"o2","step":1');
    const { errors } = messages(edit("taps.jsonl", (ls) => ls.map((l, i) => (i === line - 1 ? l.replace(MAKE, ORDER) : l))));
    expect(errors).toContain(`taps.jsonl:${line} step 1 of "latte" happens at "Espresso machine" (${MAKE}), but this tap names "Order (till)" (${ORDER}).`);
  });

  it("catches a step tapped before the step before it, and a missing order line", () => {
    const step0 = lineOf("taps.jsonl", '"orderId":"o4","step":0');
    const orderLine = lineOf("taps.jsonl", '"orderId":"o4","itemId"');
    const { errors, warnings } = messages(edit("taps.jsonl", (ls) => ls.filter((_, i) => i !== step0 - 1)));
    expect(errors.some((e) => e.includes('order "o4" step 1 is tapped before step 0'))).toBe(true);
    expect(warnings.some((w) => w.includes('order "o4" has no tap for step 0'))).toBe(true);
    const noOrder = messages(edit("taps.jsonl", (ls) => ls.filter((_, i) => i !== orderLine - 1)));
    expect(noOrder.errors.some((e) => e.includes('"done" for order "o4", but no "order" line shows that order'))).toBe(true);
  });

  it("errors on taps after the end and warns when there is no end", () => {
    const noEnd = messages(edit("taps.jsonl", (ls) => ls.filter((l) => !l.includes('"type":"end"'))));
    expect(noEnd.errors).toEqual([]);
    expect(noEnd.warnings.some((w) => w.includes('there is no "end" line'))).toBe(true);
    const early = messages(edit("taps.jsonl", (ls) => ls.map((l) => (l.includes('"type":"end"') ? '{"type":"end","t":50}' : l))));
    expect(early.errors.some((e) => e.includes('comes after the "end" (t=50)'))).toBe(true);
  });

  it("checks ids across files", () => {
    const ghost = messages(edit("layout.json", (ls) => ls.map((l) => l.replace(`"stationId": "${MAKE}"`, '"stationId": "nope"'))));
    expect(ghost.errors.some((e) => e.includes('workers[1] ("blue") stands at "nope", which is not in scan.json.'))).toBe(true);
    expect(ghost.errors.some((e) => e.includes('nobody works at "Espresso machine"'))).toBe(true);
    const stranger = messages(edit("positions.jsonl", (ls) => ls.map((l) => l.replace('"workerId":"yellow"', '"workerId":"purple"'))));
    expect(stranger.errors.some((e) => e.includes('worker "purple" is not in layout.json "workers"'))).toBe(true);
  });

  it("warns about a header that is not the first line, with an example", () => {
    const { errors } = messages(edit("positions.jsonl", (ls) => ls.slice(1)));
    expect(errors.some((e) => e.includes('the first line must be the header {"type":"header","format":"dryrun.positions"'))).toBe(true);
  });

  it("warns about tracking jumps and likely unit mistakes", () => {
    const jump = messages(
      edit("positions.jsonl", (ls) => ls.map((l, i) => (i === 300 ? l.replace(/"x":[\d.]+/, '"x":4.4').replace(/"z":[\d.]+/, '"z":3.4') : l))),
    );
    expect(jump.warnings.some((w) => /jumps faster than 4 m\/s/.test(w))).toBe(true);
    const cm = JSON.parse(good["scan.json"]) as { boxes: { size: { w: number } }[] };
    const big = { ...cm, boxes: cm.boxes.map((b, i) => (i === 0 ? { ...b, size: { ...b.size, w: 131 } } : b)) };
    expect(messages(withFile("scan.json", JSON.stringify(big))).warnings.some((w) => w.includes("is this centimetres?"))).toBe(true);
  });

  it("reads a folder from disk and warns when run.json id and folder name differ", () => {
    const dir = mkdtempSync(join(tmpdir(), "dryrun-validate-"));
    try {
      const folder = join(dir, "my-run");
      mkdirSync(folder);
      for (const [name, text] of Object.entries(good)) writeFileSync(join(folder, name), text);
      const r = validateRunFolder(folder);
      expect(r.errors).toEqual([]);
      expect(r.warnings.map((w) => w.message)).toEqual(['"id" is "counter-a" but the folder is called "my-run". Use the same name for both.']);
      expect(validateRunFolder(join(dir, "nope")).errors[0]?.message).toBe("does not exist");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
