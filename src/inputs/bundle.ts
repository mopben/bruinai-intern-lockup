/**
 * Run bundles: a run folder's six files <-> a RunBundle.
 *
 * A run folder holds run.json, scan.json, setup.json, layout.json, taps.jsonl
 * and positions.jsonl. The same code reads fixtures, team recordings and live
 * sessions saved by the stage, so all three are interchangeable.
 */
import {
  FORMAT_VERSION,
  POSITIONS_FORMAT,
  TAPS_FORMAT,
} from "../core/types";
import type { PositionSample, PositionsHeader, RunBundle, TapEvent, TapsHeader } from "../core/types";
import {
  parseLayout,
  parsePositions,
  parseRunMeta,
  parseScan,
  parseSetup,
  parseTaps,
  type ParseResult,
} from "./parse";

export const RUN_FILES = {
  meta: "run.json",
  scan: "scan.json",
  setup: "setup.json",
  layout: "layout.json",
  taps: "taps.jsonl",
  positions: "positions.jsonl",
} as const;

export type RunFileName = (typeof RUN_FILES)[keyof typeof RUN_FILES];
export type RunFiles = Readonly<Record<RunFileName, string>>;

/** Default samples-per-second written into a positions header when none is known. */
export const DEFAULT_POSITIONS_HZ = 10;

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const jsonl = (lines: readonly unknown[]): string => lines.map((l) => JSON.stringify(l)).join("\n") + "\n";

export function serialiseTaps(events: readonly TapEvent[], startedAt: string): string {
  const header: TapsHeader = { type: "header", format: TAPS_FORMAT, version: FORMAT_VERSION, startedAt };
  return jsonl([header, ...events]);
}

export function serialisePositions(
  samples: readonly PositionSample[],
  startedAt: string,
  hz: number = DEFAULT_POSITIONS_HZ,
): string {
  const header: PositionsHeader = { type: "header", format: POSITIONS_FORMAT, version: FORMAT_VERSION, startedAt, hz };
  return jsonl([header, ...samples]);
}

export interface SerialiseOptions {
  /** Written to both JSONL headers. Defaults to meta.recordedAt. */
  readonly startedAt?: string;
  readonly positionsHz?: number;
}

/** Turns a bundle into the six files of a run folder, in fixture format. */
export function serialiseRunBundle(bundle: RunBundle, options: SerialiseOptions = {}): RunFiles {
  const startedAt = options.startedAt ?? bundle.meta.recordedAt;
  return {
    "run.json": json(bundle.meta),
    "scan.json": json(bundle.scan),
    "setup.json": json(bundle.setup),
    "layout.json": json(bundle.layout),
    "taps.jsonl": serialiseTaps(bundle.taps, startedAt),
    "positions.jsonl": serialisePositions(bundle.positions, startedAt, options.positionsHz),
  };
}

/** Parses the six files of a run folder. `folder` is only used in error messages. */
export function parseRunFiles(files: Partial<RunFiles>, folder = ""): ParseResult<RunBundle> {
  const prefix = folder === "" ? "" : `${folder.replace(/\/+$/, "")}/`;
  const name = (file: RunFileName) => `${prefix}${file}`;
  for (const file of Object.values(RUN_FILES)) {
    if (files[file] === undefined) return { ok: false, error: `${name(file)} is missing` };
  }
  const text = (file: RunFileName) => files[file] ?? "";

  const meta = parseRunMeta(text("run.json"), name("run.json"));
  if (!meta.ok) return meta;
  const scan = parseScan(text("scan.json"), name("scan.json"));
  if (!scan.ok) return scan;
  const setup = parseSetup(text("setup.json"), name("setup.json"));
  if (!setup.ok) return setup;
  const layout = parseLayout(text("layout.json"), name("layout.json"));
  if (!layout.ok) return layout;
  const taps = parseTaps(text("taps.jsonl"), name("taps.jsonl"));
  if (!taps.ok) return taps;
  const positions = parsePositions(text("positions.jsonl"), name("positions.jsonl"));
  if (!positions.ok) return positions;

  return {
    ok: true,
    value: {
      meta: meta.value,
      scan: scan.value,
      setup: setup.value,
      layout: layout.value,
      taps: taps.value.events,
      positions: positions.value.samples,
    },
  };
}
