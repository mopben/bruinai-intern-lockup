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

  it("accepts tasks, covers and capacity without unknown-field warnings", () => {
    const setup = JSON.parse(good["setup.json"]) as { items: { boxId: string }[]; menu: { steps: { stationId: string; fetchFrom?: string[] }[] }[] };
    const layout = JSON.parse(good["layout.json"]) as { workers: { stationId: string }[] };
    const menu = setup.menu.map((m) => ({ ...m, tasks: m.steps.map((s, k) => ({ id: `t${k}`, ...s, ...(k > 0 ? { after: [`t${k - 1}`] } : {}) })) }));
    const items = setup.items.map((i) => (i.boxId === MAKE ? { ...i, capacity: 2 } : i));
    const workers = layout.workers.map((w, i) => (i === 0 ? { ...w, covers: [MAKE] } : w));
    const r = messages({ ...good, "setup.json": JSON.stringify({ ...setup, items, menu }), "layout.json": JSON.stringify({ ...layout, workers }) });
    expect(r.errors).toEqual([]);
    expect(r.warnings.filter((w) => /unknown field/.test(w))).toEqual([]);
  });

  it("reports a task cycle naming setup.json, the menu item and the task", () => {
    const setup = JSON.parse(good["setup.json"]) as { menu: { id: string; steps: { stationId: string; fetchFrom?: string[] }[] }[] };
    const menu = setup.menu.map((m, mi) =>
      mi === 0 ? { ...m, tasks: m.steps.map((s, k) => ({ id: `t${k}`, ...s, after: k === 0 ? [`t${m.steps.length - 1}`] : [`t${k - 1}`] })) } : m,
    );
    const { errors } = messages(withFile("setup.json", JSON.stringify({ ...setup, menu })));
    const last = `t${(setup.menu[0]?.steps.length ?? 1) - 1}`;
    expect(errors).toContain(`setup.json menu[0] ("${setup.menu[0]?.id}"): task "t0" waits for "${last}", which must come earlier in the list.`);
  });

  it("reports a covers id that is not a station", () => {
    const layout = JSON.parse(good["layout.json"]) as { workers: { id: string }[] };
    const workers = layout.workers.map((w, i) => (i === 0 ? { ...w, covers: [MAKE, "nope", base.ids.fridge] } : w));
    const { errors } = messages(withFile("layout.json", JSON.stringify({ ...layout, workers })));
    const who = layout.workers[0]?.id;
    expect(errors).toContain(`layout.json workers[0] ("${who}") covers "nope", which is not in scan.json.`);
    expect(errors.some((e) => e.startsWith(`layout.json workers[0] ("${who}") covers "`) && e.includes("which is not a station"))).toBe(true);
  });

  describe("join items and covered stations", () => {
    type Step = { stationId: string; fetchFrom?: string[] };
    const setup = JSON.parse(good["setup.json"]) as { menu: { id: string; steps: Step[] }[] };
    // p and q start on release; r waits for both.
    const joinSetup = JSON.stringify({
      ...setup,
      menu: setup.menu.map((m) => ({
        ...m,
        tasks: m.steps.map((s, k) => ({ id: ["p", "q", "r"][k] ?? `t${k}`, ...s, ...(k === 2 ? { after: ["p", "q"] } : {}) })),
      })),
    });
    type Tap = { type: string; t: number; orderId?: string; step?: number };
    /** Swaps the times of two done taps of order o4, keeping the file's line order. */
    const swapTimes = (a: number, b: number) => (ls: string[]) => {
      const parsed = ls.map((l) => (l.trim() ? (JSON.parse(l) as Tap) : undefined));
      const find = (step: number) => parsed.findIndex((p) => p?.type === "done" && p.orderId === "o4" && p.step === step);
      const [ia, ib] = [find(a), find(b)];
      const [ta, tb] = [parsed[ia]?.t, parsed[ib]?.t];
      return ls.map((l, i) => (i === ia ? JSON.stringify({ ...parsed[i], t: tb }) : i === ib ? JSON.stringify({ ...parsed[i], t: ta }) : l));
    };
    const tapErrors = (files: Partial<Record<RunFileName, string>>) => messages(files).errors.filter((e) => e.startsWith("taps.jsonl"));

    it("accepts join taps in an order the graph allows but a chain does not (q before p)", () => {
      const taps = edit("taps.jsonl", swapTimes(0, 1))["taps.jsonl"];
      expect(tapErrors({ ...good, "taps.jsonl": taps })).not.toEqual([]); // a chain still rejects it
      expect(tapErrors({ ...good, "setup.json": joinSetup, "taps.jsonl": taps })).toEqual([]);
    });

    it("still flags a join task tapped before a task it waits for (r before p)", () => {
      const taps = edit("taps.jsonl", swapTimes(0, 2))["taps.jsonl"];
      const errors = tapErrors({ ...good, "setup.json": joinSetup, "taps.jsonl": taps });
      expect(errors.some((e) => e.includes('order "o4" task "r" (step 2) is tapped before task "p" (step 0), which it waits for.'))).toBe(true);
    });

    it("counts a station as staffed when a worker covers it", () => {
      const layout = JSON.parse(good["layout.json"]) as { workers: { id: string; stationId: string; covers?: string[] }[] };
      const moved = (covers: boolean) =>
        JSON.stringify({
          ...layout,
          workers: layout.workers.map((w) => (w.stationId === MAKE ? { ...w, stationId: ORDER, ...(covers ? { covers: [MAKE] } : {}) } : w)),
        });
      const nobody = (text: string) => messages(withFile("layout.json", text)).errors.filter((e) => e.includes("nobody works at"));
      expect(nobody(moved(true))).toEqual([]);
      expect(nobody(moved(false)).some((e) => e.includes('nobody works at "Espresso machine"'))).toBe(true);
    });
  });

  it("still passes the three fixture folders", () => {
    for (const name of ["counter-a", "counter-b-fridge-closer", "counter-c-fourth-worker"]) {
      const path = join("fixtures", name);
      expect(formatReport(path, validateRunFolder(path))).toMatch(/^OK: /);
    }
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
