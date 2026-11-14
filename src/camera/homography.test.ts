import { describe, expect, it } from "vitest";
import { applyHomography, reprojectionErrors, solveHomography, type Pt } from "./homography";
import type { Mat3 } from "./linalg";

const square: Pt[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

function solved(src: Pt[], dst: Pt[]): Mat3 {
  const r = solveHomography(src, dst);
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

describe("solveHomography", () => {
  it("identity for identical point sets", () => {
    const h = solved(square, square);
    for (const p of [{ x: 0.3, y: 0.7 }, { x: 5, y: -2 }]) {
      const q = applyHomography(h, p)!;
      expect(q.x).toBeCloseTo(p.x, 9);
      expect(q.y).toBeCloseTo(p.y, 9);
    }
  });

  it("recovers an affine map (scale, rotate, shift)", () => {
    const f = (p: Pt): Pt => ({ x: 200 + 100 * p.x - 30 * p.y, y: 50 + 30 * p.x + 100 * p.y });
    const h = solved(square, square.map(f));
    const q = applyHomography(h, { x: 2.5, y: -1 })!;
    expect(q.x).toBeCloseTo(f({ x: 2.5, y: -1 }).x, 6);
    expect(q.y).toBeCloseTo(f({ x: 2.5, y: -1 }).y, 6);
  });

  it("recovers a true perspective map from 4 and from 8 noisy-free points", () => {
    const truth: Mat3 = [120, 15, 300, -10, 80, 200, 0.05, 0.2, 1];
    const src4 = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }];
    const src8 = [...src4, { x: 2, y: 1 }, { x: 1, y: 2.5 }, { x: 3.3, y: 0.4 }, { x: 0.5, y: 0.5 }];
    for (const src of [src4, src8]) {
      const h = solved(src, src.map((p) => applyHomography(truth, p)!));
      const probe = { x: 2.2, y: 1.7 };
      const a = applyHomography(h, probe)!;
      const b = applyHomography(truth, probe)!;
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(1e-6);
    }
  });

  it("least squares with noise gives small reprojection error", () => {
    const truth: Mat3 = [120, 15, 300, -10, 80, 200, 0.05, 0.2, 1];
    const src = Array.from({ length: 12 }, (_, i) => ({ x: (i % 4) * 1.3, y: Math.floor(i / 4) * 1.1 }));
    const noise = [0.4, -0.3, 0.2, -0.5, 0.1, 0.3, -0.2, 0.4, -0.1, 0.2, -0.4, 0.3];
    const dst = src.map((p, i) => {
      const q = applyHomography(truth, p)!;
      return { x: q.x + noise[i]!, y: q.y - noise[(i + 3) % 12]! };
    });
    const h = solved(src, dst);
    const errs = reprojectionErrors(h, src, dst);
    expect(Math.max(...errs)).toBeLessThan(1.5);
  });

  it("rejects fewer than four points", () => {
    const r = solveHomography(square.slice(0, 3), square.slice(0, 3));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/four/i);
  });

  it("rejects mismatched lengths", () => {
    expect(solveHomography(square, square.slice(0, 3)).ok).toBe(false);
  });

  it("rejects collinear points", () => {
    const line = [0, 1, 2, 3, 4].map((x) => ({ x, y: 2 * x + 1 }));
    expect(solveHomography(line, line).ok).toBe(false);
  });

  it("rejects four points with three in a line", () => {
    const bad = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }];
    const r = solveHomography(bad, square);
    expect(r.ok).toBe(false);
  });

  it("rejects non-finite input and duplicate points", () => {
    expect(solveHomography([...square.slice(0, 3), { x: NaN, y: 0 }], square).ok).toBe(false);
    expect(solveHomography([square[0]!, square[0]!, square[1]!, square[2]!], square).ok).toBe(false);
  });
});
