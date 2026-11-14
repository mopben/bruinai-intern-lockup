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
      `  pace: ${cal.paceMethod}, ${cal.walkSpeedMps.toFixed(2)} m/s + ${cal.walkOverheadS.toFixed(2)} s per round trip (${cal.walkSpeedSamples} samples), work samples ${cal.sampleCount}, clamped ${cal.clampedCount}; warnings: ${cal.warnings.join(' | ') || 'none'}`,
      `  trips: ${[...new Set(cal.paceTrips.map((t) => t.group))].map((g) => { const ts = cal.paceTrips.filter((t) => t.group === g); return `${g.split(':')[0]}->${(a.setup.items.find((i) => i.boxId === g.split(':')[1])?.name ?? '?')} n=${ts.length} d=${(ts.reduce((s, t) => s + t.distanceM, 0) / ts.length).toFixed(2)}m t=${(ts.reduce((s, t) => s + t.durationS, 0) / ts.length).toFixed(2)}s`; }).join('; ')}`,
      `  trust: error ${trust.errorPct?.toFixed(1)}% -> "${describeTrustError(trust.errorPct)}"; measured ${trust.measuredMeanS?.toFixed(1)} s vs model ${trust.modelMeanS?.toFixed(1)} s on ${trust.pairs.length} held-out orders; caveat: ${trust.caveat}`,
      `  pairs: ${trust.pairs.map((p) => `${p.orderId} ${p.measuredS.toFixed(1)}/${p.modelS.toFixed(1)}`).join(", ")}`,
    ];
    const wc = trust.walkCheck;
    lines.push(
      `  baseline (guess the learned mean): ${trust.baselineErrorPct?.toFixed(1)}%; walk check: ${wc ? `MAE ${wc.maeS.toFixed(2)} s (${wc.mapePct.toFixed(1)}%) on ${wc.trips} trips; by group ${wc.byGroup.map((g) => `${g.group.split(":")[0]} ${g.errorS.toFixed(2)} s`).join(", ")}` : trust.walkCheckReason}`,
    );
    // Loose guards, not claims: a regression that breaks the model badly should fail here.
    expect(trust.errorPct).not.toBeNull();
    expect(Math.abs(trust.errorPct as number)).toBeLessThan(25);
    expect(wc).not.toBeNull();
    expect((wc as NonNullable<typeof wc>).maeS).toBeLessThan(2);

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
          `measured ${measured.toFixed(1)} s; ${check.missText}; ` +
          `last order predicted ${formatRange(pred.lastFinish)}, measured ${summariseRun(runB).lastFinishS?.toFixed(1)} s` +
          (pred.extrapolation.outside ? `\n    extrapolation: ${pred.extrapolation.note}` : ""),
      );
      // Loose guard, not a claim: measured within 3 s of the predicted range.
      expect(check.missByS).toBeLessThan(3);
      expect(Number.isFinite(pred.meanOrderTime.p50)).toBe(true);
      expect(Number.isFinite(measured)).toBe(true);
    }
    console.info(`[fixtures]\n${lines.join("\n")}`);
  });
});
