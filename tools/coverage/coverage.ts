/**
 * Coverage of the prediction on a held-out world.
 *
 * Generates fresh runs (original, fridge closer, fourth worker) from the world
 * generator with seeds that are NOT the fixture seeds, predicts each changed run
 * from its matching original alone, and counts how often the measured mean order
 * time fell inside the predicted p10-p90 range (nominally 80%).
 *
 * This is a check, not a tuning loop: do not change model constants to raise it.
 *
 *   npx tsx tools/coverage/coverage.ts [n]
 */
import { generateRun } from "../world/generate";
import { RUNS } from "../world/runs";
import {
  calibrate,
  checkPrediction,
  predict,
  reconstructRun,
  resolveWorld,
  summariseRun,
  trustCheck,
  type Layout,
  type PositionSample,
  type Scan,
  type Setup,
  type TapEvent,
} from "../../src/core/index";

/** Fixed, and different from the fixture seeds (1101, 2202, 3303). */
export const COVERAGE_SEEDS: readonly number[] = Array.from({ length: 300 }, (_, i) => 50_000 + 7919 * i);

interface Parsed {
  readonly scan: Scan;
  readonly setup: Setup;
  readonly layout: Layout;
  readonly taps: readonly TapEvent[];
  readonly positions: readonly PositionSample[];
}

function jsonl<T>(text: string): T[] {
  return text
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as { type: string })
    .filter((l) => l.type !== "header") as T[];
}

function parsed(runIndex: number, seed: number): Parsed {
  const cfg = RUNS[runIndex];
  if (!cfg) throw new Error(`No run config ${runIndex}`);
  const files = generateRun({ ...cfg, seed }).files;
  return {
    scan: JSON.parse(files["scan.json"]) as Scan,
    setup: JSON.parse(files["setup.json"]) as Setup,
    layout: JSON.parse(files["layout.json"]) as Layout,
    taps: jsonl<TapEvent>(files["taps.jsonl"]),
    positions: jsonl<PositionSample>(files["positions.jsonl"]),
  };
}

export interface ChangeCoverage {
  readonly change: string;
  readonly n: number;
  readonly inside: number;
  /** Mean of measured - predicted p50, seconds (positive: the model was too fast). */
  readonly meanBiasS: number;
  /** Mean p90 - p10 width, seconds. */
  readonly meanWidthS: number;
  readonly extrapolated: number;
}

export interface CoverageReport {
  readonly changes: readonly ChangeCoverage[];
  readonly trustErrorsPct: readonly number[];
}

export function runCoverage(n: number, seeds: readonly number[] = COVERAGE_SEEDS, reps = 200): CoverageReport {
  const acc = [1, 2].map((idx) => ({ change: RUNS[idx]?.id ?? String(idx), n: 0, inside: 0, bias: 0, width: 0, extrapolated: 0 }));
  const trust: number[] = [];
  for (let k = 0; k < n; k += 1) {
    const base = seeds[3 * k];
    if (base === undefined || seeds[3 * k + 2] === undefined) throw new Error(`Need ${3 * n} seeds, have ${seeds.length}.`);
    const a = parsed(0, base);
    const worldA = resolveWorld(a.scan, a.setup, a.layout);
    const cal = calibrate(worldA, reconstructRun(a.setup, a.taps), a.positions);
    const t = trustCheck(worldA, a.taps, a.positions, { reps });
    if (t.errorPct !== null) trust.push(t.errorPct);
    [1, 2].forEach((idx, j) => {
      const b = parsed(idx, seeds[3 * k + idx] as number);
      const pred = predict(resolveWorld(a.scan, a.setup, b.layout), cal, { releases: b.setup.schedule.orders, reps });
      const measured = summariseRun(reconstructRun(b.setup, b.taps)).meanOrderTimeS;
      if (measured === null) return;
      const s = acc[j] as (typeof acc)[number];
      s.n += 1;
      if (checkPrediction(pred.meanOrderTime, measured).inside) s.inside += 1;
      s.bias += measured - pred.meanOrderTime.p50;
      s.width += pred.meanOrderTime.p90 - pred.meanOrderTime.p10;
      if (pred.extrapolation.outside) s.extrapolated += 1;
    });
  }
  return {
    changes: acc.map((s) => ({ change: s.change, n: s.n, inside: s.inside, meanBiasS: s.bias / s.n, meanWidthS: s.width / s.n, extrapolated: s.extrapolated })),
    trustErrorsPct: trust,
  };
}

export function formatReport(r: CoverageReport): string {
  const lines = r.changes.map(
    (c) =>
      `${c.change}: inside p10-p90 ${c.inside}/${c.n} (${((100 * c.inside) / c.n).toFixed(0)}%, nominal 80%); ` +
      `mean bias (measured - p50) ${c.meanBiasS >= 0 ? "+" : ""}${c.meanBiasS.toFixed(2)} s; mean width ${c.meanWidthS.toFixed(2)} s; extrapolating in ${c.extrapolated}/${c.n}`,
  );
  const te = r.trustErrorsPct;
  const meanAbs = te.reduce((s, v) => s + Math.abs(v), 0) / Math.max(1, te.length);
  lines.push(`trust check on the originals: mean |error| ${meanAbs.toFixed(1)}% over ${te.length} runs`);
  return lines.join("\n");
}

const isMain = process.argv[1] !== undefined && /coverage\.ts$/.test(process.argv[1]);
if (isMain) {
  const n = Number(process.argv[2] ?? 40);
  const t0 = Date.now();
  const report = runCoverage(n);
  process.stdout.write(`${formatReport(report)}\n(${n} fresh worlds, ${((Date.now() - t0) / 1000).toFixed(1)} s)\n`);
}
