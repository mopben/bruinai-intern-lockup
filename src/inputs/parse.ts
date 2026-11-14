/**
 * Parsers for the file formats, with errors a person can act on.
 *
 * Every parser returns a ParseResult instead of throwing. Error messages name
 * the file, the line (for .jsonl) and the field, e.g.
 *   taps.jsonl line 4: field "step" must be a whole number
 */
import type { z } from "zod";
import type {
  Layout,
  PositionSample,
  PositionsHeader,
  RunMeta,
  Scan,
  Setup,
  TapEvent,
  TapsHeader,
} from "../core/types";
import {
  layoutSchema,
  positionSampleSchema,
  positionsHeaderSchema,
  runMetaSchema,
  scanSchema,
  setupSchema,
  tapEventSchema,
  tapsHeaderSchema,
} from "./schemas";

export type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

/** Thrown by unwrap() and by loaders; the message is already friendly. */
export class InputFormatError extends Error {
  override readonly name = "InputFormatError";
}

export function unwrap<T>(result: ParseResult<T>): T {
  if (!result.ok) throw new InputFormatError(result.error);
  return result.value;
}

const ok = <T>(value: T): ParseResult<T> => ({ ok: true, value });
const fail = <T>(error: string): ParseResult<T> => ({ ok: false, error });

function pathText(path: readonly PropertyKey[]): string {
  return path.reduce<string>((acc, key) => {
    if (typeof key === "number") return `${acc}[${key}]`;
    const k = String(key);
    return acc === "" ? k : `${acc}.${k}`;
  }, "");
}

function issueText(issue: z.core.$ZodIssue): string {
  const where = issue.path.length > 0 ? `field "${pathText(issue.path)}"` : "the value";
  const message = issue.message.replace(/^Invalid input: /, "");
  if (issue.code === "invalid_type" && /received undefined/.test(issue.message)) {
    return `${where} is missing (${message.replace(/, received undefined/, "")})`;
  }
  return `${where} ${message}`;
}

/** Formats the first few issues of a zod error into one sentence. */
export function describeIssues(issues: readonly z.core.$ZodIssue[], max = 3): string {
  const shown = issues.slice(0, max).map(issueText);
  const more = issues.length > max ? ` (and ${issues.length - max} more)` : "";
  return `${shown.join("; ")}${more}`;
}

/** Validates an already-decoded value against a schema. */
export function validate<T>(schema: z.ZodType<T>, value: unknown, where: string): ParseResult<T> {
  const result = schema.safeParse(value);
  return result.success ? ok(result.data) : fail(`${where}: ${describeIssues(result.error.issues)}`);
}

function decodeJson(text: string, where: string): ParseResult<unknown> {
  try {
    return ok(JSON.parse(text) as unknown);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return fail(`${where} is not valid JSON (${reason})`);
  }
}

function parseJsonFile<T>(schema: z.ZodType<T>, text: string, fileName: string): ParseResult<T> {
  if (text.trim() === "") return fail(`${fileName} is empty`);
  const decoded = decodeJson(text, fileName);
  return decoded.ok ? validate(schema, decoded.value, fileName) : fail(decoded.error);
}

export const parseScan = (text: string, fileName = "scan.json"): ParseResult<Scan> =>
  parseJsonFile(scanSchema, text, fileName);
export const parseSetup = (text: string, fileName = "setup.json"): ParseResult<Setup> =>
  parseJsonFile(setupSchema, text, fileName);
export const parseLayout = (text: string, fileName = "layout.json"): ParseResult<Layout> =>
  parseJsonFile(layoutSchema, text, fileName);
export const parseRunMeta = (text: string, fileName = "run.json"): ParseResult<RunMeta> =>
  parseJsonFile(runMetaSchema, text, fileName);

// ---------------------------------------------------------------------------
// JSONL
// ---------------------------------------------------------------------------

interface NumberedLine {
  readonly lineNo: number;
  readonly text: string;
}

/** Splits JSONL text into non-blank lines with their 1-based line numbers. Handles \r\n and a trailing newline. */
export function jsonlLines(text: string): readonly NumberedLine[] {
  return text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .map((line, i) => ({ lineNo: i + 1, text: line.trim() }))
    .filter((line) => line.text !== "");
}

interface JsonlParts<H, E> {
  readonly header: H;
  readonly events: readonly E[];
}

function parseJsonl<H, E extends { readonly t: number }>(
  text: string,
  fileName: string,
  headerSchema: z.ZodType<H>,
  eventSchema: z.ZodType<E>,
  headerExample: string,
): ParseResult<JsonlParts<H, E>> {
  const lines = jsonlLines(text);
  const first = lines[0];
  if (first === undefined) return fail(`${fileName} is empty; line 1 must be the header ${headerExample}`);

  const headerJson = decodeJson(first.text, `${fileName} line ${first.lineNo}`);
  if (!headerJson.ok) return fail(headerJson.error);
  const header = validate(headerSchema, headerJson.value, `${fileName} line ${first.lineNo} (header)`);
  if (!header.ok) return fail(`${header.error}. The first line must be the header ${headerExample}`);

  const events: E[] = [];
  for (const line of lines.slice(1)) {
    const where = `${fileName} line ${line.lineNo}`;
    const decoded = decodeJson(line.text, where);
    if (!decoded.ok) return fail(decoded.error);
    const event = validate(eventSchema, decoded.value, where);
    if (!event.ok) return fail(event.error);
    events.push(event.value);
  }
  // Stable sort: the rest of the product may assume time order.
  const sorted = events.map((e, i) => ({ e, i })).sort((a, b) => a.e.t - b.e.t || a.i - b.i).map(({ e }) => e);
  return ok({ header: header.value, events: sorted });
}

export interface ParsedTaps {
  readonly header: TapsHeader;
  readonly events: readonly TapEvent[];
}

export interface ParsedPositions {
  readonly header: PositionsHeader;
  readonly samples: readonly PositionSample[];
}

/** Parses taps.jsonl. Events come back sorted by t (stable). */
export function parseTaps(text: string, fileName = "taps.jsonl"): ParseResult<ParsedTaps> {
  const parsed = parseJsonl(
    text,
    fileName,
    tapsHeaderSchema,
    tapEventSchema,
    '{"type":"header","format":"dryrun.taps","version":1,"startedAt":"..."}',
  );
  if (!parsed.ok) return fail(parsed.error);
  const ends = parsed.value.events.filter((e) => e.type === "end");
  if (ends.length > 1) return fail(`${fileName} has ${ends.length} "end" lines; a run has at most one`);
  const last = parsed.value.events[parsed.value.events.length - 1];
  if (ends.length === 1 && last?.type !== "end") {
    return fail(`${fileName}: the "end" line must have the largest t (events come after it)`);
  }
  return ok({ header: parsed.value.header, events: parsed.value.events });
}

/** Parses positions.jsonl. Samples come back sorted by t (stable). */
export function parsePositions(text: string, fileName = "positions.jsonl"): ParseResult<ParsedPositions> {
  const parsed = parseJsonl(
    text,
    fileName,
    positionsHeaderSchema,
    positionSampleSchema,
    '{"type":"header","format":"dryrun.positions","version":1,"startedAt":"...","hz":10}',
  );
  return parsed.ok ? ok({ header: parsed.value.header, samples: parsed.value.events }) : fail(parsed.error);
}
