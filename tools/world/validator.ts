/**
 * Checks a run folder (fixture or real recording) and explains every problem
 * in plain words: which file, which line, which field, and what to do.
 *
 * Errors mean the product cannot load the folder as it is. Warnings mean it
 * can, but something looks wrong (a typo, a missing tap, a jump in a track).
 */
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import type { z } from "zod";
import type { Layout, PositionSample, PositionsHeader, RunMeta, Scan, Setup, TapEvent, TapsHeader } from "../../src/core/types";
import { crossCheck, type Issue, type Parsed } from "./checks";
import { LOOSE, STRICT } from "./schemas";

export type { Issue } from "./checks";

export const RUN_FILES = ["run.json", "scan.json", "setup.json", "layout.json", "taps.jsonl", "positions.jsonl"] as const;
export type RunFileName = (typeof RUN_FILES)[number];

export interface Report {
  readonly errors: readonly Issue[];
  readonly warnings: readonly Issue[];
  /** A one-line description when the folder could be read. */
  readonly facts?: string;
}

const MAX_PER_FILE = 12;

function where(path: readonly PropertyKey[]): string {
  return path.reduce<string>((acc, k) => (typeof k === "number" ? `${acc}[${k}]` : acc ? `${acc}.${String(k)}` : String(k)), "");
}

function describe(issue: z.core.$ZodIssue): string {
  const field = issue.path.length > 0 ? `field "${where(issue.path)}"` : "this line";
  if (issue.code === "unrecognized_keys") {
    const keys = issue.keys.map((k) => `"${k}"`).join(", ");
    return `${issue.path.length > 0 ? `${field} has` : "has"} unknown field${issue.keys.length > 1 ? "s" : ""} ${keys}; ${issue.keys.length > 1 ? "they are" : "it is"} ignored (check the spelling)`;
  }
  const msg = issue.message.replace(/^Invalid input: /, "");
  return `${field} ${msg}`;
}

interface Checked<T> {
  readonly value?: T;
  readonly errors: readonly Issue[];
  readonly warnings: readonly Issue[];
}

/** Strict pass for unknown-field warnings, loose pass for the data. */
function check<T>(strict: z.ZodType, loose: z.ZodType<T>, value: unknown, file: string, line?: number): Checked<T> {
  const at = (message: string): Issue => (line === undefined ? { file, message } : { file, line, message });
  const s = strict.safeParse(value);
  const unknown = s.success ? [] : s.error.issues.filter((i) => i.code === "unrecognized_keys").map((i) => at(describe(i)));
  const l = loose.safeParse(value);
  if (l.success) return { value: l.data, errors: [], warnings: unknown };
  return { errors: l.error.issues.map((i) => at(describe(i))), warnings: unknown };
}

function decode(textIn: string, file: string, line?: number): { value?: unknown; error?: Issue } {
  try {
    return { value: JSON.parse(textIn) as unknown };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    const hint = /property name|Unexpected token '?\}/i.test(reason) ? " (a trailing comma or a missing quote?)" : "";
    const issue = { file, ...(line === undefined ? {} : { line }), message: `is not valid JSON: ${reason}${hint}` };
    return { error: issue };
  }
}

function jsonFile<T>(name: string, textIn: string | undefined, strict: z.ZodType, loose: z.ZodType<T>): Checked<T> {
  if (textIn === undefined) return { errors: [{ file: name, message: `is missing. A run folder holds ${RUN_FILES.join(", ")}` }], warnings: [] };
  if (textIn.trim() === "") return { errors: [{ file: name, message: "is empty" }], warnings: [] };
  const d = decode(textIn.replace(/^﻿/, ""), name);
  return d.error ? { errors: [d.error], warnings: [] } : check(strict, loose, d.value, name);
}

export interface Lines<H, E> {
  readonly header?: H;
  readonly events: readonly { readonly line: number; readonly value: E }[];
}

function jsonlFile<H, E>(
  name: string,
  textIn: string | undefined,
  header: { strict: z.ZodType; loose: z.ZodType<H>; example: string },
  event: { strict: z.ZodType; loose: z.ZodType<E> },
): Checked<Lines<H, E>> {
  if (textIn === undefined) return { errors: [{ file: name, message: `is missing. A run folder holds ${RUN_FILES.join(", ")}` }], warnings: [] };
  const lines = textIn
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .map((t, i) => ({ line: i + 1, text: t.trim() }))
    .filter((l) => l.text !== "");
  const first = lines[0];
  if (!first) return { errors: [{ file: name, message: `is empty. Line 1 must be the header ${header.example}` }], warnings: [] };
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const h = decode(first.text, name, first.line);
  const hc = h.error ? undefined : check(header.strict, header.loose, h.value, name, first.line);
  if (h.error) errors.push(h.error);
  if (hc) {
    warnings.push(...hc.warnings);
    if (hc.errors.length > 0) errors.push(...hc.errors, { file: name, line: first.line, message: `the first line must be the header ${header.example}` });
  }
  const events: { line: number; value: E }[] = [];
  for (const l of lines.slice(1)) {
    const d = decode(l.text, name, l.line);
    if (d.error) {
      errors.push(d.error);
      continue;
    }
    const c = check(event.strict, event.loose, d.value, name, l.line);
    errors.push(...c.errors);
    warnings.push(...c.warnings);
    if (c.value !== undefined) events.push({ line: l.line, value: c.value });
  }
  return { value: { header: hc?.value, events }, errors, warnings };
}

const capped = (issues: readonly Issue[]): readonly Issue[] => {
  const byFile = new Map<string, number>();
  return issues.flatMap((i) => {
    const n = (byFile.get(i.file) ?? 0) + 1;
    byFile.set(i.file, n);
    if (n <= MAX_PER_FILE) return [i];
    if (n === MAX_PER_FILE + 1) {
      const more = issues.filter((x) => x.file === i.file).length - MAX_PER_FILE;
      return [{ file: i.file, message: `... and ${more} more like these` }];
    }
    return [];
  });
};

/** Validates the six files given as text (missing ones as undefined). */
export function validateRunFiles(files: Partial<Record<RunFileName, string>>, folderName?: string): Report {
  const run = jsonFile<RunMeta>("run.json", files["run.json"], STRICT.run, LOOSE.run);
  const scan = jsonFile<Scan>("scan.json", files["scan.json"], STRICT.scan, LOOSE.scan);
  const setup = jsonFile<Setup>("setup.json", files["setup.json"], STRICT.setup, LOOSE.setup);
  const layout = jsonFile<Layout>("layout.json", files["layout.json"], STRICT.layout, LOOSE.layout);
  const taps = jsonlFile<TapsHeader, TapEvent>(
    "taps.jsonl",
    files["taps.jsonl"],
    { strict: STRICT.tapsHeader, loose: LOOSE.tapsHeader, example: '{"type":"header","format":"dryrun.taps","version":1,"startedAt":"2026-11-13T10:00:00Z"}' },
    { strict: STRICT.tapEvent, loose: LOOSE.tapEvent },
  );
  const positions = jsonlFile<PositionsHeader, PositionSample>(
    "positions.jsonl",
    files["positions.jsonl"],
    {
      strict: STRICT.positionsHeader,
      loose: LOOSE.positionsHeader,
      example: '{"type":"header","format":"dryrun.positions","version":1,"startedAt":"2026-11-13T10:00:00Z","hz":10}',
    },
    { strict: STRICT.pos, loose: LOOSE.pos },
  );
  const parts = [run, scan, setup, layout, taps, positions];
  const parsed: Parsed = {
    folderName,
    run: run.value,
    scan: scan.value,
    setup: setup.value,
    layout: layout.value,
    taps: taps.value,
    positions: positions.value,
  };
  const cross = crossCheck(parsed);
  return {
    errors: capped([...parts.flatMap((p) => p.errors), ...cross.errors]),
    warnings: capped([...parts.flatMap((p) => p.warnings), ...cross.warnings]),
    ...(cross.facts ? { facts: cross.facts } : {}),
  };
}

export function validateRunFolder(dir: string): Report {
  if (!existsSync(dir)) return { errors: [{ file: dir, message: "does not exist" }], warnings: [] };
  const files = Object.fromEntries(
    RUN_FILES.flatMap((name) => {
      const path = `${dir}/${name}`;
      return existsSync(path) ? [[name, readFileSync(path, "utf8")]] : [];
    }),
  ) as Partial<Record<RunFileName, string>>;
  return validateRunFiles(files, basename(dir));
}

const issueLine = (i: Issue): string => `  ${i.file}${i.line === undefined ? "" : ` line ${i.line}`}: ${i.message}`;

export function formatReport(dir: string, report: Report): string {
  const head =
    report.errors.length === 0
      ? `OK: ${dir} can be loaded${report.facts ? ` (${report.facts})` : ""}.`
      : `NOT OK: ${dir} has ${report.errors.length} problem${report.errors.length > 1 ? "s" : ""} to fix.`;
  const errs = report.errors.length > 0 ? ["", "Errors (must fix):", ...report.errors.map(issueLine)] : [];
  const warns = report.warnings.length > 0 ? ["", "Warnings (worth a look):", ...report.warnings.map(issueLine)] : [];
  return [head, ...errs, ...warns, ""].join("\n");
}
