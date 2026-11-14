import { describe, expect, it } from "vitest";
import { formatReport, runCoverage } from "./coverage";

/**
 * Regression GUARD, not a claim. The bound is deliberately loose: it only catches a
 * change that wrecks the prediction on fresh worlds. The real numbers come from
 * `npx tsx tools/coverage/coverage.ts 40` and are reported, never tuned for.
 */
describe("prediction coverage on fresh worlds (guard)", () => {
  it("does not collapse", () => {
    const r = runCoverage(10, undefined, 100);
    console.info(`[coverage guard]\n${formatReport(r)}`);
    for (const c of r.changes) {
      expect(c.n).toBe(10);
      expect(c.inside).toBeGreaterThanOrEqual(3);
      expect(Math.abs(c.meanBiasS)).toBeLessThan(4);
    }
  }, 60_000);
});
