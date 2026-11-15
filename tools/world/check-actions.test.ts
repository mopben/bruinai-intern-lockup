import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateRun } from "./generate";
import { RUNS } from "./runs";
import { validateRunFiles, validateRunFolder, type RunFileName } from "./validator";

const base = generateRun(RUNS[0] as (typeof RUNS)[number]);
const good = base.files as Record<string, string>;
const { order: ORDER, make: MAKE, fridge: FRIDGE, pickup: PICKUP, sink: SINK } = base.ids;

const WORKER_IDS = (JSON.parse(good["layout.json"] ?? "{}") as { workers: { id: string }[] }).workers.map((w) => w.id);

const HEADER = '{"type":"header","format":"dryrun.actions","version":1,"startedAt":"2026-11-12T15:10:05.000Z","source":"zones+model","model":"test"}';
const seg = (fields: Record<string, unknown>) => JSON.stringify({ type: "action", ...fields });
const GOOD_LINES = [
  seg({ workerId: "red", t0: 0, t1: 1.4, kind: "idle" }),
  seg({ workerId: "red", t0: 1.4, t1: 2.8, kind: "work", boxId: ORDER }),
  seg({ workerId: "red", t0: 2.8, t1: 4, kind: "walk" }),
  seg({ workerId: "blue", t0: 2.9, t1: 7.1, kind: "fetch", boxId: FRIDGE }),
  seg({ workerId: "blue", t0: 7.1, t1: 11.2, kind: "work", boxId: MAKE, label: "steaming milk", confidence: 0.71 }),
  seg({ workerId: "yellow", t0: 11.2, t1: 12, kind: "carry", boxId: PICKUP }),
];
const actionsFile = (lines: readonly string[]) => [HEADER, ...lines].join("\n");
/** Line number in the file of GOOD_LINES[i] (the header is line 1). */
const lineNo = (i: number) => i + 2;

const report = (actions: string | undefined) => {
  const files: Partial<Record<RunFileName, string>> = actions === undefined ? good : { ...good, "actions.jsonl": actions };
  const r = validateRunFiles(files, "counter-a");
  const only = (issues: typeof r.errors) =>
    issues.filter((i) => i.file === "actions.jsonl").map((i) => `${i.line ?? "-"} ${i.message}`);
  return { errors: only(r.errors), warnings: only(r.warnings), allErrors: r.errors, facts: r.facts };
};
const replaced = (i: number, line: string) => GOOD_LINES.map((l, j) => (j === i ? line : l));

describe("validator: actions.jsonl", () => {
  it("is optional: a folder without it validates as before", () => {
    const r = report(undefined);
    expect(r.allErrors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.facts).not.toMatch(/action/);
  });

  it("accepts a good file and counts its segments", () => {
    const r = report(actionsFile(GOOD_LINES));
    expect(r.allErrors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.facts).toMatch(/, 6 action segments$/);
  });

  it("checks the header, with an example", () => {
    const { errors } = report(actionsFile(GOOD_LINES).replace('"source":"zones+model"', '"source":"video"'));
    expect(errors).toEqual([
      '1 field "source" must be one of "zones", "zones+model"',
      '1 the first line must be the header {"type":"header","format":"dryrun.actions","version":1,"startedAt":"2026-11-13T10:00:00Z","source":"zones"}',
    ]);
    expect(report("").errors[0]).toMatch(/^- is empty\. Line 1 must be the header \{"type":"header","format":"dryrun\.actions"/);
  });

  it("names the field for a bad kind, a missing boxId and a bad confidence", () => {
    const kind = report(actionsFile(replaced(0, seg({ workerId: "red", t0: 0, t1: 1.4, kind: "nap" }))));
    expect(kind.errors).toEqual(['2 field "kind" must be "work", "fetch", "carry", "walk" or "idle"']);
    const box = report(actionsFile(replaced(1, seg({ workerId: "red", t0: 1.4, t1: 2.8, kind: "work" }))));
    expect(box.errors).toEqual(['3 field "boxId" is missing']);
    const conf = report(actionsFile(replaced(4, GOOD_LINES[4]?.replace("0.71", "71") ?? "")));
    expect(conf.errors).toEqual(['6 field "confidence" must be between 0 and 1']);
  });

  it("errors on a worker that is not in layout.json", () => {
    const { errors } = report(actionsFile(replaced(0, seg({ workerId: "purple", t0: 0, t1: 1.4, kind: "idle" }))));
    expect(errors).toEqual([
      `2 worker "purple" is not in layout.json "workers". Use the same ids in all files (known: ${WORKER_IDS.join(", ")}).`,
    ]);
  });

  it("errors on a box that is not in scan.json", () => {
    const { errors } = report(actionsFile(replaced(1, seg({ workerId: "red", t0: 1.4, t1: 2.8, kind: "work", boxId: "nope" }))));
    expect(errors).toEqual(['3 "work" names box "nope", which is not in scan.json. Copy the id from scan.json.']);
  });

  it("errors on a box whose role does not fit the kind", () => {
    const work = report(actionsFile(replaced(1, seg({ workerId: "red", t0: 1.4, t1: 2.8, kind: "work", boxId: FRIDGE }))));
    expect(work.errors).toEqual([`3 "work" names "Milk fridge" (${FRIDGE}), whose role is "storage"; it must be "station".`]);
    const fetch = report(actionsFile(replaced(3, seg({ workerId: "blue", t0: 2.9, t1: 7.1, kind: "fetch", boxId: MAKE }))));
    expect(fetch.errors).toEqual([`5 "fetch" names "Espresso machine" (${MAKE}), whose role is "station"; it must be "storage".`]);
    const carry = report(actionsFile(replaced(5, seg({ workerId: "yellow", t0: 11.2, t1: 12, kind: "carry", boxId: SINK }))));
    expect(carry.errors).toEqual([`7 "carry" names "Sink" (${SINK}), whose role is "fixture"; it must be "pickup" or "station".`]);
    const toStation = report(actionsFile(replaced(5, seg({ workerId: "yellow", t0: 11.2, t1: 12, kind: "carry", boxId: MAKE }))));
    expect(toStation.errors).toEqual([]);
  });

  it("errors when a segment does not end after it starts", () => {
    const { errors } = report(actionsFile(replaced(0, seg({ workerId: "red", t0: 1.4, t1: 1.4, kind: "idle" }))));
    expect(errors).toEqual(["2 t1=1.4 is not later than t0=1.4. A segment must end after it starts."]);
  });

  it("errors on overlapping segments of one worker, naming the other line", () => {
    const { errors } = report(actionsFile(replaced(2, seg({ workerId: "red", t0: 2.5, t1: 4, kind: "walk" }))));
    expect(errors).toEqual([
      `4 worker "red" does two things at once: this segment (t0=2.5 to t1=4) starts before the one on line ${lineNo(1)} ends (t1=2.8). One worker's segments must not overlap; fix t0 or t1.`,
    ]);
  });

  it("warns about lines out of time order, without other errors", () => {
    const swapped = [GOOD_LINES[3], GOOD_LINES[2], ...GOOD_LINES.slice(4), ...GOOD_LINES.slice(0, 2)] as string[];
    const r = report(actionsFile(swapped));
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([
      "3 t0=2.8 is earlier than the line above (t0=2.9). Lines are read in time order anyway, but keep the file sorted by t0.",
      "6 t0=0 is earlier than the line above (t0=11.2). Lines are read in time order anyway, but keep the file sorted by t0.",
    ]);
  });

  it("warns about segments that end after the run's end", () => {
    const late = [...GOOD_LINES, seg({ workerId: "red", t0: 85, t1: 95, kind: "idle" }), seg({ workerId: "red", t0: 95, t1: 99, kind: "walk" })];
    const r = report(actionsFile(late));
    expect(r.errors).toEqual([]);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/^8 2 segments end after the run ended \(t=88\.\d+; first here: t1=95\)\. Check the video's clock against the taps\.$/);
  });

  it("warns about a label without a confidence, and the other way round", () => {
    const noConf = report(actionsFile(replaced(1, seg({ workerId: "red", t0: 1.4, t1: 2.8, kind: "work", boxId: ORDER, label: "ringing up" }))));
    expect(noConf.errors).toEqual([]);
    expect(noConf.warnings).toEqual(['3 has "label" but no "confidence". The labeller writes both; add the confidence or remove the label.']);
    const noLabel = report(actionsFile(replaced(1, seg({ workerId: "red", t0: 1.4, t1: 2.8, kind: "work", boxId: ORDER, confidence: 0.5 }))));
    expect(noLabel.warnings).toEqual(['3 has "confidence" but no "label". The labeller writes both; add the label or remove the confidence.']);
  });

  it("warns about a boxId on a kind that has none, as an ignored field", () => {
    const r = report(actionsFile(replaced(0, seg({ workerId: "red", t0: 0, t1: 1.4, kind: "idle", boxId: ORDER }))));
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual(['2 has unknown field "boxId"; it is ignored (check the spelling)']);
  });

  it("reads actions.jsonl from a folder on disk when it is there", () => {
    const dir = mkdtempSync(join(tmpdir(), "dryrun-actions-"));
    try {
      const folder = join(dir, "counter-a");
      mkdirSync(folder);
      for (const [name, text] of Object.entries(good)) writeFileSync(join(folder, name), text);
      expect(validateRunFolder(folder).facts).not.toMatch(/action/);
      writeFileSync(join(folder, "actions.jsonl"), actionsFile(replaced(0, seg({ workerId: "purple", t0: 0, t1: 1.4, kind: "idle" }))));
      expect(validateRunFolder(folder).errors.map((e) => e.file)).toEqual(["actions.jsonl"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
