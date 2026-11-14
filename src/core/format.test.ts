import { describe, expect, it } from "vitest";
import {
  describeTrustError,
  formatCountRange,
  formatGapSeconds,
  formatMetres,
  formatPercent,
  formatRange,
  formatSeconds,
  formatSecondsRange,
} from "./format";
import { checkPrediction, summariseRun } from "./compare";
import { mean, median, quantile, rangeOf } from "./stats";
import { mixSeed, mulberry32 } from "./rng";
import type { RunTrace } from "./trace";

describe("format", () => {
  it("rounds ranges outward without false precision", () => {
    expect(formatSecondsRange(18.4, 25.2)).toBe("18–26 s");
    expect(formatRange({ p10: 18.4, p50: 21, p90: 25.2 })).toBe("18–26 s");
    expect(formatSecondsRange(20.1, 20.3)).toBe("about 20 s");
    expect(formatSecondsRange(103, 127)).toBe("100–130 s");
    expect(formatSecondsRange(Number.NaN, 1)).toBe("—");
  });

  it("formats seconds, metres and percents", () => {
    expect(formatSeconds(21.4)).toBe("21 s");
    expect(formatSeconds(152)).toBe("2 min 30 s");
    expect(formatSeconds(180)).toBe("3 min");
    expect(formatSeconds(Infinity)).toBe("—");
    expect(formatMetres(12.345)).toBe("12.3 m");
    expect(formatMetres(3)).toBe("3.0 m");
    expect(formatMetres(Number.NaN)).toBe("—");
    expect(formatPercent(7.6)).toBe("8%");
    expect(formatPercent(-7.6)).toBe("8%");
    expect(formatPercent(-7.6, true)).toBe("−8%");
    expect(formatPercent(7.6, true)).toBe("+8%");
    expect(formatPercent(0.2, true)).toBe("0%");
    expect(formatPercent(Number.NaN)).toBe("—");
    expect(formatCountRange({ p10: 7, p50: 8, p90: 9 })).toBe("7–9 orders");
    expect(formatCountRange({ p10: 8, p50: 8, p90: 8 })).toBe("8 orders");
  });

  it("describes trust errors in plain words", () => {
    expect(describeTrustError(8.4)).toBe("The model was 8% slower than the real run.");
    expect(describeTrustError(-12)).toBe("The model was 12% faster than the real run.");
    expect(describeTrustError(0.3)).toMatch(/within 1%/);
    expect(describeTrustError(null)).toMatch(/could not/);
  });
});

describe("checkPrediction", () => {
  const range = { p10: 18, p50: 21, p90: 26 };
  it("inside", () =>
    expect(checkPrediction(range, 20)).toEqual({ inside: true, side: null, missByS: 0, missByPct: 0, offMedianS: -1, missText: "inside the predicted range" }));
  it("never says 0.0 s for a real miss", () => {
    expect(checkPrediction(range, 26.02).missText).toBe("under 0.1 s above the range");
    expect(checkPrediction(range, 26.3).missText).toBe("0.3 s above the range");
    expect(checkPrediction(range, 17.5).missText).toBe("0.5 s below the range");
    expect(formatGapSeconds(0)).toBe("0 s");
    expect(formatGapSeconds(Number.NaN)).toBe("\u2014");
    expect(formatSeconds(0.3)).toBe("under 1 s");
    expect(formatSeconds(0)).toBe("0 s");
  });
  it("above", () => expect(checkPrediction(range, 29)).toMatchObject({ inside: false, side: "above", missByS: 3 }));
  it("below", () => {
    const c = checkPrediction(range, 9);
    expect(c).toMatchObject({ inside: false, side: "below", missByS: 9, missByPct: 50 });
  });
});

describe("summariseRun", () => {
  it("averages finished orders only", () => {
    const o = (id: string, t: number | null) => ({ orderId: id, itemId: "x", releasedAt: 0, steps: [], completed: t !== null, finishedAt: t, orderTime: t });
    const run: RunTrace = { orders: [o("a", 10), o("b", 20), o("c", null)], queue: { stationIds: [], intervals: [], endT: 30 }, movements: [], endT: 30 };
    expect(summariseRun(run)).toEqual({ meanOrderTimeS: 15, lastFinishS: 20, completed: 2, total: 3 });
    expect(summariseRun({ ...run, orders: [] }).meanOrderTimeS).toBeNull();
  });
});

describe("stats and rng", () => {
  it("quantiles interpolate", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(quantile([0, 10], 0.1)).toBeCloseTo(1);
    expect(rangeOf([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])).toEqual({ p10: 2, p50: 6, p90: 10 });
    expect(mean([])).toBeNaN();
    expect(quantile([], 0.5)).toBeNaN();
  });

  it("mulberry32 is repeatable and roughly uniform", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const xs = Array.from({ length: 2000 }, () => a());
    expect(xs.slice(0, 5)).toEqual(Array.from({ length: 5 }, () => b()));
    expect(Math.abs(mean(xs) - 0.5)).toBeLessThan(0.03);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(mixSeed(1, 2)).not.toBe(mixSeed(2, 1));
  });
});
