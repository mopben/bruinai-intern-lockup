import { describe, expect, it } from "vitest";
import { emptyCalibration, parseCalibration, rescaleCalibration, serialiseCalibration, storageKey } from "./calib-file";

const base = {
  ...emptyCalibration("cam1", "k1", { width: 1280, height: 720 }),
  pairs: [{ label: "a", world: { x: 1, y: 0, z: 2 }, image: { x: 100, y: 200 } }],
  hatHeights: { red: 1.66 },
  colours: { red: { h: 2, s: 0.8, v: 0.9 } },
};

describe("calibration file", () => {
  it("round-trips", () => {
    const r = parseCalibration(serialiseCalibration(base));
    expect(r.ok && r.value).toEqual(base);
  });
  it("rejects junk with a friendly message", () => {
    expect(parseCalibration("{").ok).toBe(false);
    const r = parseCalibration(JSON.stringify({ ...base, hatHeights: { red: 16.5 } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/hatHeights/);
  });
  it("rescales clicks to a new picture size", () => {
    const r = rescaleCalibration(base, { width: 1920, height: 1080 });
    expect(r.pairs[0]!.image).toEqual({ x: 150, y: 300 });
    expect(base.pairs[0]!.image).toEqual({ x: 100, y: 200 });
  });
  it("keys storage by camera and kitchen", () => {
    expect(storageKey("a", "b")).not.toBe(storageKey("a", "c"));
  });
});
