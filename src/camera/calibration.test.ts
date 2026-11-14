import { describe, expect, it } from "vitest";
import { imageToFloorAt } from "./camera-model";
import { solveCalibration, type PointPair } from "./calibration";
import { cameraMatrix, project } from "./pinhole";

const p = cameraMatrix({ position: { x: 2.3, y: 2.9, z: 4.9 }, target: { x: 2.2, y: 0.4, z: 1 }, focalPx: 1000, width: 1280, height: 720, cx: 652 });
const pair = (x: number, y: number, z: number): PointPair => ({ label: `${x},${y},${z}`, world: { x, y, z }, image: project(p, { x, y, z })! });
const floor = [pair(0.8, 0, 0.65), pair(3.4, 0, 0.62), pair(4.4, 0, 2.4), pair(0.1, 0, 2.9), pair(2.0, 0, 1.6)];
const tops = [pair(0.8, 0.9, 0.04), pair(3.4, 0.88, 0.6), pair(4.4, 0.77, 2.3)];

describe("solveCalibration", () => {
  it("asks for more floor points", () => {
    const r = solveCalibration(floor.slice(0, 3), { width: 1280, height: 720 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/1 more floor point/);
  });

  it("uses box tops when there are two or more, and is exact", () => {
    const r = solveCalibration([...floor, ...tops], { width: 1280, height: 720 });
    if (!r.ok) throw new Error(r.error);
    expect(r.value.model.method).toBe("box-tops");
    expect(r.value.rmsCm).toBeLessThan(0.01);
    const g = imageToFloorAt(r.value.model, project(p, { x: 1.5, y: 1.65, z: 1.1 })!, 1.65)!;
    expect(Math.hypot(g.x - 1.5, g.z - 1.1)).toBeLessThan(1e-3);
  });

  it("falls back to the lens assumption with floor points only", () => {
    const r = solveCalibration(floor, { width: 1280, height: 720 });
    if (!r.ok) throw new Error(r.error);
    expect(r.value.model.method).toBe("lens");
    expect(r.value.topCount).toBe(0);
  });

  it("shows a bad click as a large error on that point", () => {
    const more = [...floor, pair(1.2, 0, 1.0), pair(3.0, 0, 1.1), pair(4.0, 0, 0.9)];
    const bad = more.map((q, i) => (i === 4 ? { ...q, image: { x: q.image.x + 40, y: q.image.y } } : q));
    const r = solveCalibration([...bad, ...tops], { width: 1280, height: 720 });
    if (!r.ok) throw new Error(r.error);
    expect(r.value.suspect).toBe(4);
    const clean = solveCalibration([...more, ...tops], { width: 1280, height: 720 });
    expect(clean.ok && clean.value.suspect).toBeUndefined();
  });
});
