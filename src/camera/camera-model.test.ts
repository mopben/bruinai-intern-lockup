import { describe, expect, it } from "vitest";
import { cameraPosition, imageToFloorAt, modelFromLens, modelFromTops, projectAt } from "./camera-model";
import type { Mat3 } from "./linalg";
import { cameraMatrix, project, type CameraPose } from "./pinhole";

const pose: CameraPose = {
  position: { x: 2.3, y: 2.9, z: 4.9 },
  target: { x: 2.2, y: 0.4, z: 1.0 },
  focalPx: 1000,
  width: 1280,
  height: 720,
};

/** The floor (x, z) -> image homography of a camera, scaled by k. */
function floorH(p: readonly number[], k: number): Mat3 {
  return [p[0]!, p[2]!, p[3]!, p[4]!, p[6]!, p[7]!, p[8]!, p[10]!, p[11]!].map((v) => v * k) as unknown as Mat3;
}

const heads = [
  { x: 1.2, z: 1.0 },
  { x: 2.1, z: 1.05 },
  { x: 0.6, z: 2.7 },
  { x: 3.9, z: 2.2 },
];

describe("modelFromLens (height from floor points alone)", () => {
  it("maps a head at a known height to the floor point below it", () => {
    const p = cameraMatrix(pose);
    for (const k of [1, -3.7, 0.001]) {
      const m = modelFromLens(floorH(p, k), { width: 1280, height: 720 }, { x: 2, z: 1.5 });
      if (!m.ok) throw new Error(m.error);
      for (const h of heads) {
        const px = project(p, { x: h.x, y: 1.65, z: h.z })!;
        const g = imageToFloorAt(m.value, px, 1.65)!;
        expect(Math.hypot(g.x - h.x, g.z - h.z)).toBeLessThan(1e-3);
      }
      const c = cameraPosition(m.value)!;
      expect(Math.hypot(c.x - 2.3, c.y - 2.9, c.z - 4.9)).toBeLessThan(1e-3);
    }
  });

  // Known weakness, measured here: for a camera facing the counter squarely,
  // a horizontal principal-point error of 5 px already costs about 11 cm.
  // That is why box-top points (modelFromTops) are the preferred method.
  it("stays within 3 cm when the real principal point is 10 px off vertically", () => {
    const p = cameraMatrix({ ...pose, cy: 350 });
    const m = modelFromLens(floorH(p, 1), { width: 1280, height: 720 }, { x: 2, z: 1.5 });
    if (!m.ok) throw new Error(m.error);
    for (const h of heads) {
      const g = imageToFloorAt(m.value, project(p, { x: h.x, y: 1.65, z: h.z })!, 1.65)!;
      expect(Math.hypot(g.x - h.x, g.z - h.z)).toBeLessThan(0.03);
    }
  });

  it("without the height correction the error would be metres", () => {
    const p = cameraMatrix(pose);
    const m = modelFromLens(floorH(p, 1), { width: 1280, height: 720 }, { x: 2, z: 1.5 });
    if (!m.ok) throw new Error(m.error);
    const h = heads[0]!;
    const g = imageToFloorAt(m.value, project(p, { x: h.x, y: 1.65, z: h.z })!, 0)!;
    expect(Math.hypot(g.x - h.x, g.z - h.z)).toBeGreaterThan(1);
  });

  it("falls back to an assumed lens for a straight-down view, and says so", () => {
    // An exactly top-down camera sees the floor as a pure scaling: no perspective to measure.
    const affine: Mat3 = [100, 0, 440, 0, 100, 210, 0, 0, 1];
    const m = modelFromLens(affine, { width: 1280, height: 720 }, { x: 2, z: 1.5 });
    expect(m.ok).toBe(true);
    if (m.ok) expect(m.value.note).toMatch(/assumed/i);
  });
});

describe("modelFromTops (height from box tops of known height)", () => {
  it("recovers the vertical direction exactly from two or more top corners", () => {
    const p = cameraMatrix({ ...pose, cx: 690, cy: 330 });
    const tops = [
      { x: 0.8, y: 0.9, z: 0.04 },
      { x: 3.4, y: 0.88, z: 0.6 },
      { x: 4.4, y: 0.77, z: 2.3 },
    ].map((w) => ({ world: w, image: project(p, w)! }));
    const m = modelFromTops(floorH(p, -2), tops);
    if (!m.ok) throw new Error(m.error);
    for (const h of heads) {
      const g = imageToFloorAt(m.value, project(p, { x: h.x, y: 1.7, z: h.z })!, 1.7)!;
      expect(Math.hypot(g.x - h.x, g.z - h.z)).toBeLessThan(1e-3);
      const back = projectAt(m.value, h, 1.7)!;
      const truth = project(p, { x: h.x, y: 1.7, z: h.z })!;
      expect(Math.hypot(back.x - truth.x, back.y - truth.y)).toBeLessThan(1e-3);
    }
  });

  it("needs at least two top points above the floor", () => {
    const p = cameraMatrix(pose);
    const one = [{ world: { x: 1, y: 0.9, z: 0 }, image: project(p, { x: 1, y: 0.9, z: 0 })! }];
    const m = modelFromTops(floorH(p, 1), one);
    expect(m.ok).toBe(false);
  });
});

describe("solveHatHeight", () => {
  it("recovers the height of a hat above a known floor point", async () => {
    const { solveHatHeight } = await import("./camera-model");
    const p = cameraMatrix(pose);
    const m = modelFromLens(floorH(p, 1), { width: 1280, height: 720 }, { x: 2, z: 1.5 });
    if (!m.ok) throw new Error(m.error);
    const h = solveHatHeight(m.value, project(p, { x: 1.2, y: 1.72, z: 1.0 })!, { x: 1.2, z: 1.0 });
    expect(h.ok && h.value).toBeCloseTo(1.72, 4);
    const silly = solveHatHeight(m.value, project(p, { x: 1.2, y: 0.1, z: 1.0 })!, { x: 1.2, z: 1.0 });
    expect(silly.ok).toBe(false);
  });
});
