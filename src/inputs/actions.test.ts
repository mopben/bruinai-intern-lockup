import { describe, expect, it } from "vitest";
import type { RunActions, RunBundle } from "../core/types";
import { loadRunBundle } from "./api";
import { OPTIONAL_RUN_FILES, parseRunFiles, RUN_FILES, serialiseActions, serialiseRunBundle } from "./bundle";
import { parseActions, unwrap } from "./parse";
import { runBundleSchema } from "./schemas";
import { testActions, testBundle } from "./test-data";

const errorOf = (r: { ok: boolean; error?: string }) => (r.ok ? "" : (r.error ?? ""));
const HEADER = '{"type":"header","format":"dryrun.actions","version":1,"startedAt":"2026-11-12T15:10:05.000Z","source":"zones"}';
const file = (...lines: readonly string[]) => [HEADER, ...lines].join("\n");

describe("parseActions", () => {
  it("reads the header and the segments of a good file", () => {
    const text = file(
      '{"type":"action","workerId":"red","t0":1.4,"t1":2.8,"kind":"work","boxId":"b-till"}',
      '{"type":"action","workerId":"blue","t0":2.9,"t1":7.1,"kind":"walk"}',
      '{"type":"action","workerId":"blue","t0":7.1,"t1":11.2,"kind":"work","boxId":"b-make","label":"steaming milk","confidence":0.71}',
    );
    const parsed = unwrap(parseActions(text));
    expect(parsed.header).toEqual({
      type: "header",
      format: "dryrun.actions",
      version: 1,
      startedAt: "2026-11-12T15:10:05.000Z",
      source: "zones",
    });
    expect(parsed.segments).toHaveLength(3);
    expect(parsed.segments[2]).toEqual({
      type: "action",
      workerId: "blue",
      t0: 7.1,
      t1: 11.2,
      kind: "work",
      boxId: "b-make",
      label: "steaming milk",
      confidence: 0.71,
    });
  });

  it("accepts a model name in the header", () => {
    const header = HEADER.replace('"source":"zones"', '"source":"zones+model","model":"clip-v2"');
    expect(unwrap(parseActions(header)).header).toMatchObject({ source: "zones+model", model: "clip-v2" });
  });

  it("sorts segments by t0, stably", () => {
    const text = file(
      '{"type":"action","workerId":"red","t0":5,"t1":6,"kind":"idle"}',
      '{"type":"action","workerId":"blue","t0":1,"t1":2,"kind":"idle"}',
      '{"type":"action","workerId":"blue","t0":5,"t1":6,"kind":"walk"}',
    );
    expect(unwrap(parseActions(text)).segments.map((s) => `${s.workerId}:${s.kind}`)).toEqual(["blue:idle", "red:idle", "blue:walk"]);
  });

  it("requires the header first, with an example", () => {
    expect(errorOf(parseActions(""))).toMatch(/^actions\.jsonl is empty; line 1 must be the header \{"type":"header","format":"dryrun\.actions"/);
    expect(errorOf(parseActions(HEADER.replace('"zones"', '"camera"')))).toMatch(
      /^actions\.jsonl line 1 \(header\): field "source".*The first line must be the header/,
    );
  });

  it("names the line and field of a bad segment", () => {
    expect(errorOf(parseActions(file('{"type":"action","workerId":"red","t0":1,"t1":2,"kind":"dance"}')))).toBe(
      'actions.jsonl line 2: field "kind" must be "work", "fetch", "carry", "walk" or "idle"',
    );
    expect(errorOf(parseActions(file('{"type":"action","workerId":"red","t0":-1,"t1":2,"kind":"idle"}')))).toBe(
      'actions.jsonl line 2: field "t0" must be 0 or more',
    );
  });

  it("needs a boxId for work, fetch and carry", () => {
    for (const kind of ["work", "fetch", "carry"]) {
      expect(errorOf(parseActions(file(`{"type":"action","workerId":"red","t0":1,"t1":2,"kind":"${kind}"}`)))).toMatch(
        /^actions\.jsonl line 2: field "boxId" is missing/,
      );
    }
  });

  it("needs t1 later than t0", () => {
    expect(errorOf(parseActions(file('{"type":"action","workerId":"red","t0":2,"t1":2,"kind":"idle"}')))).toBe(
      'actions.jsonl line 2: field "t1" must be later than t0',
    );
  });

  it("keeps confidence between 0 and 1", () => {
    const line = '{"type":"action","workerId":"red","t0":1,"t1":2,"kind":"idle","label":"x","confidence":1.5}';
    expect(errorOf(parseActions(file(line)))).toBe('actions.jsonl line 2: field "confidence" must be between 0 and 1');
  });

  it("rejects overlapping segments of one worker, allows touching ones and other workers", () => {
    const touching = file(
      '{"type":"action","workerId":"red","t0":1,"t1":2,"kind":"idle"}',
      '{"type":"action","workerId":"blue","t0":1.5,"t1":3,"kind":"idle"}',
      '{"type":"action","workerId":"red","t0":2,"t1":3,"kind":"walk"}',
    );
    expect(parseActions(touching).ok).toBe(true);
    const overlap = file(
      '{"type":"action","workerId":"red","t0":1,"t1":2.5,"kind":"idle"}',
      '{"type":"action","workerId":"red","t0":2,"t1":3,"kind":"walk"}',
    );
    expect(errorOf(parseActions(overlap, "runs/a/actions.jsonl"))).toBe(
      'runs/a/actions.jsonl: worker "red" does two things at once (t0=1 to t1=2.5 and t0=2 to t1=3). One worker\'s segments must not overlap.',
    );
  });
});

const withActions: RunBundle = { ...testBundle, actions: testActions };

describe("actions in run bundles", () => {
  it("is optional: a bundle without it serialises to the six files and loads without it", () => {
    const files = serialiseRunBundle(testBundle);
    expect(Object.keys(files).sort()).toEqual(Object.values(RUN_FILES).sort());
    expect("actions" in unwrap(parseRunFiles(files))).toBe(false);
  });

  it("round-trips through actions.jsonl when present", () => {
    const files = serialiseRunBundle(withActions);
    expect(Object.keys(files).sort()).toEqual([...Object.values(RUN_FILES), ...Object.values(OPTIONAL_RUN_FILES)].sort());
    expect(files["actions.jsonl"]).toBe(serialiseActions(testActions));
    expect(unwrap(parseRunFiles(files))).toEqual(withActions);
  });

  it("names the folder in an actions error", () => {
    const files = { ...serialiseRunBundle(testBundle), "actions.jsonl": file('{"type":"action","kind":"idle","t0":1,"t1":2}') };
    expect(errorOf(parseRunFiles(files, "runs/a"))).toMatch(/^runs\/a\/actions\.jsonl line 2: field "workerId" is missing/);
  });

  it("is accepted, and optional, in a POSTed bundle", () => {
    expect(runBundleSchema.safeParse(JSON.parse(JSON.stringify(withActions))).success).toBe(true);
    expect(runBundleSchema.safeParse(JSON.parse(JSON.stringify(testBundle))).success).toBe(true);
  });

  it("refuses a POSTed bundle whose actions overlap, so it is never saved unloadable", () => {
    const [first] = testActions.segments;
    const clash = { ...withActions, actions: { ...testActions, segments: [...testActions.segments, { ...first, t0: 1, t1: 1.5 }] } };
    const result = runBundleSchema.safeParse(JSON.parse(JSON.stringify(clash)));
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/^worker "red" does two things at once/);
  });
});

describe("loading actions over HTTP", () => {
  const routesFor = (bundle: RunBundle, extra: Record<string, Response> = {}) => {
    const files = serialiseRunBundle(bundle) as Record<string, string>;
    return async (url: string) => {
      const name = url.replace(/^\/r\//, "");
      const fixed = extra[name];
      if (fixed) return fixed;
      const body = files[name];
      return body === undefined ? new Response("nope", { status: 404 }) : new Response(body);
    };
  };

  it("loads actions.jsonl when the folder has it", async () => {
    const loaded: RunBundle = await loadRunBundle("/r/", routesFor(withActions));
    expect(loaded.actions).toEqual<RunActions>(testActions);
  });

  it("leaves actions out when the file is not there (404)", async () => {
    const loaded = await loadRunBundle("/r/", routesFor(testBundle));
    expect(loaded).toEqual(testBundle);
    expect(loaded.actions).toBeUndefined();
  });

  it("still fails loudly when actions.jsonl cannot be read for another reason", async () => {
    const broken = routesFor(testBundle, { "actions.jsonl": new Response("boom", { status: 500 }) });
    await expect(loadRunBundle("/r/", broken)).rejects.toThrow("Could not load /r/actions.jsonl (HTTP 500)");
  });
});
