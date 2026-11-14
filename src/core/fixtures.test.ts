/**
 * Integration on the recorded fixtures. Asserts only that the pipeline runs and the
 * numbers are sane; prints the honest numbers. Nothing here is tuned to the fixtures.
 * The prediction for run B (and C) is made from run A only.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Layout, PositionSample, Scan, Setup, TapEvent } from "./types";
import {
  calibrate,
  checkPrediction,
  describeTrustError,
  formatMetres,
  formatRange,
  formatSeconds,
  predict,
  reconstructRun,
  resolveWorld,
  summariseRun,
  trustCheck,
} from "./index";

const ROOT = join(__dirname, "..", "..", "fixtures");

interface Loaded {
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

function load(id: string): Loaded {
  const read = (f: string) => readFileSync(join(ROOT, id, f), "utf8");
  return {
    scan: JSON.parse(read("scan.json")) as Scan,
    setup: JSON.parse(read("setup.json")) as Setup,
    layout: JSON.parse(read("layout.json")) as Layout,
    taps: jsonl<TapEvent>(read("taps.jsonl")),
    positions: jsonl<PositionSample>(read("positions.jsonl")),
  };
}

const have = ["counter-a", "counter-b-fridge-closer", "counter-c-fourth-worker"].every((id) => existsSync(join(ROOT, id, "taps.jsonl")));

describe.skipIf(!have)("fixtures (honest numbers)", () => {
  it("trust check on counter-a, prediction for b and c from a alone", () => {
    const a = load("counter-a");
    const worldA = resolveWorld(a.scan, a.setup, a.layout);
    const trust = trustCheck(worldA, a.taps, a.positions);
    const runA = reconstructRun(a.setup, a.taps);
    const cal = calibrate(worldA, runA, a.positions);
    const lines: string[] = [
      `counter-a: ${runA.orders.length} orders, warnings: ${runA.warnings.length}`,
      `  walking speed ${cal.walkSpeedMps.toFixed(2)} m/s (assumed: ${cal.walkSpeedAssumed}, ${cal.walkSpeedSamples} windows), samples ${cal.sampleCount}, clamped ${cal.clampedCount}`,
      `  trust: error ${trust.errorPct?.toFixed(1)}% -> "${describeTrustError(trust.errorPct)}"; measured ${trust.measuredMeanS?.toFixed(1)} s vs model ${trust.modelMeanS?.toFixed(1)} s on ${trust.pairs.length} held-out orders; caveat: ${trust.caveat}`,
      `  pairs: ${trust.pairs.map((p) => `${p.orderId} ${p.measuredS.toFixed(1)}/${p.modelS.toFixed(1)}`).join(", ")}`,
    ];
    expect(trust.errorPct).not.toBeNull();
    expect(Number.isFinite(trust.errorPct)).toBe(true);

    const predA = predict(worldA, cal);
    const measuredA = summariseRun(runA).meanOrderTimeS as number;
    lines.push(`  self: predicted ${formatRange(predA.meanOrderTime)} (p50 ${predA.meanOrderTime.p50.toFixed(1)}), measured ${formatSeconds(measuredA)} (${measuredA.toFixed(1)}), walking ${formatMetres(predA.walkingPerOrderM)}`);

    for (const id of ["counter-b-fridge-closer", "counter-c-fourth-worker"]) {
      const b = load(id);
      const worldB = resolveWorld(a.scan, a.setup, b.layout); // the change is the layout; A's scan and setup
      const pred = predict(worldB, cal, { releases: b.setup.schedule.orders });
      const runB = reconstructRun(b.setup, b.taps);
      const measured = summariseRun(runB).meanOrderTimeS as number;
      const check = checkPrediction(pred.meanOrderTime, measured);
      lines.push(
        `${id}: walking ${formatMetres(pred.walkingPerOrderM)} (was ${formatMetres(predA.walkingPerOrderM)}); ` +
          `predicted mean order time ${formatRange(pred.meanOrderTime)} (p10 ${pred.meanOrderTime.p10.toFixed(1)}, p50 ${pred.meanOrderTime.p50.toFixed(1)}, p90 ${pred.meanOrderTime.p90.toFixed(1)}); ` +
          `measured ${measured.toFixed(1)} s; inside: ${check.inside}${check.inside ? "" : ` (${check.side} by ${check.missByS.toFixed(1)} s)`}; ` +
          `last order predicted ${formatRange(pred.lastFinish)}, measured ${summariseRun(runB).lastFinishS?.toFixed(1)} s`,
      );
      expect(Number.isFinite(pred.meanOrderTime.p50)).toBe(true);
      expect(Number.isFinite(measured)).toBe(true);
    }
    console.info(`[fixtures]\n${lines.join("\n")}`);
  });
});
