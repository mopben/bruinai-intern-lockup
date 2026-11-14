/**
 * The numbers the screen must show, recomputed here from the fixture files
 * with src/core: never typed in, so they follow the core when it changes.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildPathTable,
  calibrate,
  formatMetres,
  formatPercent,
  formatRange,
  predict,
  reconstructRun,
  resolveWorld,
  summariseRun,
  trustCheck,
  walkingPerOrder,
  type Layout,
  type Range,
} from "../../src/core";
import { parseLayout, parsePositions, parseScan, parseSetup, parseTaps, unwrap } from "../../src/inputs";

export const FIXTURES = join(import.meta.dirname, "..", "..", "fixtures");

export function loadFixture(id: string) {
  const read = (f: string) => readFileSync(join(FIXTURES, id, f), "utf8");
  return {
    scan: unwrap(parseScan(read("scan.json"))),
    setup: unwrap(parseSetup(read("setup.json"))),
    layout: unwrap(parseLayout(read("layout.json"))),
    taps: unwrap(parseTaps(read("taps.jsonl"))).events,
    positions: unwrap(parsePositions(read("positions.jsonl"))).samples,
  };
}

export interface Truth {
  readonly walkA: string;
  readonly walkB: string;
  readonly walkC: string;
  readonly timeA: string;
  readonly timeB: string;
  readonly rangeB: Range;
  readonly trustError: string;
  readonly measuredA: number;
  readonly measuredB: number;
}

/** Everything from run A only, except the measured means of A and B. */
export function computeTruth(): Truth {
  const a = loadFixture("counter-a");
  const b = loadFixture("counter-b-fridge-closer");
  const c = loadFixture("counter-c-fourth-worker");
  const world = (layout: Layout) => resolveWorld(a.scan, a.setup, layout);
  const walk = (layout: Layout) => {
    const w = world(layout);
    return formatMetres(walkingPerOrder(w, buildPathTable(w)).perOrderM);
  };
  const worldA = world(a.layout);
  const runA = reconstructRun(a.setup, a.taps);
  const cal = calibrate(worldA, runA, a.positions);
  const rangeA = predict(worldA, cal).meanOrderTime;
  const rangeB = predict(world(b.layout), cal).meanOrderTime;
  const trust = trustCheck(worldA, a.taps, a.positions);
  return {
    walkA: walk(a.layout),
    walkB: walk(b.layout),
    walkC: walk(c.layout),
    timeA: formatRange(rangeA),
    timeB: formatRange(rangeB),
    rangeB,
    trustError: trust.errorPct === null ? "—" : formatPercent(trust.errorPct),
    measuredA: summariseRun(runA).meanOrderTimeS as number,
    measuredB: summariseRun(reconstructRun(b.setup, b.taps)).meanOrderTimeS as number,
  };
}
