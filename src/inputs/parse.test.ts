import { describe, expect, it } from "vitest";
import { parseRunFiles, serialiseRunBundle, serialiseTaps, RUN_FILES } from "./bundle";
import {
  InputFormatError,
  jsonlLines,
  parseLayout,
  parsePositions,
  parseRunMeta,
  parseScan,
  parseSetup,
  parseTaps,
  unwrap,
} from "./parse";
import { testBundle, testLayout, testScan, testSetup } from "./test-data";

const errorOf = (r: { ok: boolean; error?: string }) => (r.ok ? "" : (r.error ?? ""));

describe("JSON files", () => {
  it("round-trips scan, setup, layout and run meta", () => {
    expect(unwrap(parseScan(JSON.stringify(testScan)))).toEqual(testScan);
    expect(unwrap(parseSetup(JSON.stringify(testSetup)))).toEqual(testSetup);
    expect(unwrap(parseLayout(JSON.stringify(testLayout)))).toEqual(testLayout);
    expect(unwrap(parseRunMeta(JSON.stringify(testBundle.meta)))).toEqual(testBundle.meta);
  });

  it("names the file and the field", () => {
    const bad = { ...testScan, boxes: [{ ...testScan.boxes[0], size: { w: -1, h: 1, d: 1 } }] };
    expect(errorOf(parseScan(JSON.stringify(bad)))).toBe('scan.json: field "boxes[0].size.w" must be more than 0');
  });

  it("says when a field is missing", () => {
    const { capturedAt: _omit, ...bad } = testScan;
    expect(errorOf(parseScan(JSON.stringify(bad), "my-scan.json"))).toMatch(
      /^my-scan\.json: field "capturedAt" is missing \(expected string\)/,
    );
  });

  it("rejects the wrong format tag", () => {
    expect(errorOf(parseScan(JSON.stringify({ ...testScan, format: "dryrun.setup" })))).toMatch(/field "format"/);
  });

  it("reports bad JSON and empty files", () => {
    expect(errorOf(parseSetup("{ nope"))).toMatch(/^setup\.json is not valid JSON/);
    expect(errorOf(parseLayout("  \n"))).toBe("layout.json is empty");
  });

  it("rejects bad colours with a hint", () => {
    const bad = { ...testLayout, workers: [{ ...testLayout.workers[0], color: "red" }] };
    expect(errorOf(parseLayout(JSON.stringify(bad)))).toMatch(/workers\[0\]\.color" must be a colour like #/);
  });

  it("caps the number of issues listed", () => {
    const bad = { format: 1, version: 2, units: 3, capturedAt: 4, source: 5, walls: 6, boxes: 7 };
    expect(errorOf(parseScan(JSON.stringify(bad)))).toMatch(/and \d+ more\)$/);
  });

  it("unwrap throws a friendly InputFormatError", () => {
    expect(() => unwrap(parseScan("[]"))).toThrow(InputFormatError);
  });
});

describe("tasks, covers and capacity", () => {
  const withTasks = {
    ...testSetup,
    items: testSetup.items.map((i) => (i.boxId === "b-make" ? { ...i, capacity: 2 } : i)),
    menu: [
      {
        id: "latte",
        name: "Latte",
        steps: [{ stationId: "b-till" }, { stationId: "b-make" }],
        tasks: [
          { id: "take", stationId: "b-till" },
          { id: "make", stationId: "b-make", after: ["take"] },
        ],
      },
    ],
  };
  const withCapacity = (capacity: unknown) => ({ ...testSetup, items: [{ ...testSetup.items[0], capacity }, ...testSetup.items.slice(1)] });
  const withCovers = (covers: unknown) => ({ ...testLayout, workers: [{ ...testLayout.workers[0], covers }, ...testLayout.workers.slice(1)] });

  it("parses a setup with tasks and capacity, and a layout with covers", () => {
    expect(unwrap(parseSetup(JSON.stringify(withTasks)))).toEqual(withTasks);
    const covered = withCovers(["b-make"]);
    expect(unwrap(parseLayout(JSON.stringify(covered)))).toEqual(covered);
  });

  it("rejects a capacity that is not a whole number of at least 1", () => {
    expect(errorOf(parseSetup(JSON.stringify(withCapacity(0))))).toMatch(/field "items\[0\]\.capacity" must be 1 or more/);
    expect(errorOf(parseSetup(JSON.stringify(withCapacity(1.5))))).toMatch(/field "items\[0\]\.capacity" must be a whole number/);
  });

  it("rejects an empty covers list", () => {
    expect(errorOf(parseLayout(JSON.stringify(withCovers([]))))).toMatch(/field "workers\[0\]\.covers" must name at least one station/);
  });
});

describe("JSONL", () => {
  const header = '{"type":"header","format":"dryrun.taps","version":1,"startedAt":"2026-11-13T10:00:00Z"}';

  it("ignores blank lines, CRLF, a BOM and a trailing newline", () => {
    const text = `﻿${header}\r\n\r\n{"type":"order","t":0,"orderId":"o1","itemId":"latte"}\r\n   \n{"type":"end","t":3}\n\n`;
    const parsed = unwrap(parseTaps(text));
    expect(parsed.events).toEqual([
      { type: "order", t: 0, orderId: "o1", itemId: "latte" },
      { type: "end", t: 3 },
    ]);
  });

  it("keeps real line numbers in errors", () => {
    const text = `${header}\n\n{"type":"done","t":1,"orderId":"o1","step":0.5,"stationId":"s"}\n`;
    expect(errorOf(parseTaps(text))).toBe('taps.jsonl line 3: field "step" must be a whole number');
    expect(jsonlLines(`a\n\nb\n`).map((l) => l.lineNo)).toEqual([1, 3]);
  });

  it("reports a broken line", () => {
    expect(errorOf(parseTaps(`${header}\n{"type":"order",`))).toMatch(/^taps\.jsonl line 2 is not valid JSON/);
  });

  it("requires the header first", () => {
    expect(errorOf(parseTaps(`{"type":"end","t":1}\n`))).toMatch(/line 1 \(header\).*The first line must be the header/);
    expect(errorOf(parseTaps(""))).toMatch(/is empty; line 1 must be the header/);
  });

  it("rejects unknown event types", () => {
    expect(errorOf(parseTaps(`${header}\n{"type":"oops","t":1}`))).toMatch(/line 2: field "type"/);
  });

  it("sorts events by time, stably", () => {
    const text = [
      header,
      '{"type":"order","t":5,"orderId":"b","itemId":"x"}',
      '{"type":"order","t":1,"orderId":"a","itemId":"x"}',
      '{"type":"order","t":5,"orderId":"c","itemId":"x"}',
    ].join("\n");
    expect(unwrap(parseTaps(text)).events.map((e) => (e.type === "order" ? e.orderId : ""))).toEqual(["a", "b", "c"]);
  });

  it("allows at most one end, and it must be last", () => {
    expect(errorOf(parseTaps(`${header}\n{"type":"end","t":1}\n{"type":"end","t":2}`))).toMatch(/2 "end" lines/);
    expect(errorOf(parseTaps(`${header}\n{"type":"end","t":1}\n{"type":"order","t":2,"orderId":"a","itemId":"x"}`))).toMatch(
      /must have the largest t/,
    );
  });

  it("parses positions with the header hz", () => {
    const text = '{"type":"header","format":"dryrun.positions","version":1,"startedAt":"x","hz":10}\n{"type":"pos","t":0.1,"workerId":"red","x":1,"z":2}\n';
    const parsed = unwrap(parsePositions(text));
    expect(parsed.header.hz).toBe(10);
    expect(parsed.samples).toEqual([{ type: "pos", t: 0.1, workerId: "red", x: 1, z: 2 }]);
    expect(errorOf(parsePositions(text.replace('"hz":10', '"hz":0')))).toMatch(/field "hz" must be more than 0/);
  });
});

describe("run bundles", () => {
  it("serialises to six files and parses back to the same bundle", () => {
    const files = serialiseRunBundle(testBundle);
    expect(Object.keys(files).sort()).toEqual(Object.values(RUN_FILES).sort());
    expect(files["taps.jsonl"].endsWith("\n")).toBe(true);
    expect(files["taps.jsonl"].split("\n")[0]).toBe(
      '{"type":"header","format":"dryrun.taps","version":1,"startedAt":"2026-11-13T10:00:00Z"}',
    );
    expect(unwrap(parseRunFiles(files))).toEqual(testBundle);
  });

  it("names the folder and the missing file", () => {
    const { "layout.json": _omit, ...files } = serialiseRunBundle(testBundle);
    expect(errorOf(parseRunFiles(files, "/fixtures/x/"))).toBe("/fixtures/x/layout.json is missing");
  });

  it("names the folder in a field error", () => {
    const files = { ...serialiseRunBundle(testBundle), "taps.jsonl": serialiseTaps([{ type: "end", t: -1 }], "x") };
    expect(errorOf(parseRunFiles(files, "runs/a"))).toBe('runs/a/taps.jsonl line 2: field "t" must be 0 or more');
  });
});
