import { describe, expect, it } from "vitest";
import { growRect, localToWorld, rectCorners, segmentCrossesRect, vec, worldToLocal, type OrientedRect } from "./geometry";
import { shortestPath, type Obstacle } from "./path";

const unitBox = (x: number, z: number, yaw = 0): OrientedRect => ({ center: vec(x, z), halfW: 0.5, halfD: 0.5, yaw });
const obstacle = (id: string, raw: OrientedRect, r = 0.25): Obstacle => ({ id, raw, grown: growRect(raw, r) });

describe("geometry", () => {
  it("yaw follows three.js: yaw = pi/2 turns local +z to world +x", () => {
    const r: OrientedRect = { center: vec(1, 1), halfW: 1, halfD: 1, yaw: Math.PI / 2 };
    const p = localToWorld(r, vec(0, 1));
    expect(p.x).toBeCloseTo(2);
    expect(p.z).toBeCloseTo(1);
    const back = worldToLocal(r, p);
    expect(back.x).toBeCloseTo(0);
    expect(back.z).toBeCloseTo(1);
  });

  it("segment along an edge or touching a corner does not cross", () => {
    const r = unitBox(0, 0);
    expect(segmentCrossesRect(r, vec(-1, 0.5), vec(1, 0.5))).toBe(false);
    expect(segmentCrossesRect(r, vec(-1, 0), vec(1, 0))).toBe(true);
    expect(segmentCrossesRect(r, vec(0, 1), vec(1, 0))).toBe(false); // touches corner (0.5, 0.5)
    expect(segmentCrossesRect(r, vec(-2, 0), vec(-1, 0))).toBe(false);
    expect(segmentCrossesRect(r, vec(0, 0), vec(0, 0.1))).toBe(true);
    expect(rectCorners(r)).toHaveLength(4);
  });
});

describe("shortestPath", () => {
  it("is a straight line with no obstacles", () => {
    const p = shortestPath([], vec(0, 0), vec(3, 4));
    expect(p.length).toBeCloseTo(5, 10);
    expect(p.points).toEqual([vec(0, 0), vec(3, 4)]);
    expect(p.blocked).toBe(false);
  });

  it("goes round a single box through the grown corners (hand computed)", () => {
    // 1x1 box at origin grown by 0.25 -> corners at (+-0.75, +-0.75).
    // From (-2,0) to (2,0): (-2,0)->(-0.75,0.75)->(0.75,0.75)->(2,0)
    // = 2*sqrt(1.25^2 + 0.75^2) + 1.5
    const expected = 2 * Math.sqrt(1.25 ** 2 + 0.75 ** 2) + 1.5;
    const p = shortestPath([obstacle("b", unitBox(0, 0))], vec(-2, 0), vec(2, 0));
    expect(p.length).toBeCloseTo(expected, 9);
    expect(p.points).toHaveLength(4);
    expect(Math.abs((p.points[1] as { z: number }).z)).toBeCloseTo(0.75, 9);
    expect(p.blocked).toBe(false);
  });

  it("is symmetric: a->b equals b->a, and mirrored layouts give equal lengths", () => {
    const obs = [obstacle("b", unitBox(0, 0.3))];
    const ab = shortestPath(obs, vec(-2, 0), vec(2, 0));
    const ba = shortestPath(obs, vec(2, 0), vec(-2, 0));
    expect(ab.length).toBeCloseTo(ba.length, 10);
    const mirrored = shortestPath([obstacle("b", unitBox(0, -0.3))], vec(-2, 0), vec(2, 0));
    expect(mirrored.length).toBeCloseTo(ab.length, 10);
    // Box shifted up, so the short way is below: corners at z = 0.3 - 0.75 = -0.45.
    const expected = 2 * Math.sqrt(1.25 ** 2 + 0.45 ** 2) + 1.5;
    expect(ab.length).toBeCloseTo(expected, 9);
  });

  it("handles a rotated box (45 degrees) by its corner", () => {
    const r: OrientedRect = { center: vec(0, 0), halfW: 0.5, halfD: 0.5, yaw: Math.PI / 4 };
    const p = shortestPath([obstacle("b", r, 0)], vec(-2, 0), vec(2, 0));
    // Diamond with vertices at distance sqrt(0.5) on the axes; the path goes over the top vertex.
    const h = Math.SQRT1_2;
    expect(p.length).toBeCloseTo(2 * Math.sqrt(4 + h * h), 9);
  });

  it("passes through a gap exactly one body wide", () => {
    // Two boxes 0.5 m apart: grown margins touch, path squeezes along the shared edge.
    const obs = [obstacle("l", unitBox(-0.75, 0)), obstacle("r", unitBox(0.75, 0))];
    const p = shortestPath(obs, vec(0, -2), vec(0, 2));
    expect(p.length).toBeCloseTo(4, 9);
  });

  it("an end point inside a grown margin may leave it, but not walk through the box", () => {
    // Stand point 0.1 m in front of a box (inside its 0.25 margin).
    const obs = [obstacle("b", unitBox(0, 0))];
    const start = vec(0, 0.6);
    const p = shortestPath(obs, start, vec(0, 3));
    expect(p.length).toBeCloseTo(2.4, 9);
    // Going to the far side must go round the raw box corner (0.5, 0.5) then (0.5,-0.5)? No:
    // raw box is used for this query, so the route hugs the raw corners.
    const behind = shortestPath(obs, start, vec(0, -0.6));
    const expected = 2 * Math.hypot(0.5, 0.1) + 1.0;
    expect(behind.length).toBeCloseTo(expected, 9);
  });

  it("falls back to a straight line and flags blocked when enclosed", () => {
    const wall = (x: number, z: number, w: number, d: number): Obstacle => {
      const raw: OrientedRect = { center: vec(x, z), halfW: w, halfD: d, yaw: 0 };
      return { id: `${x},${z}`, raw, grown: raw };
    };
    const ring = [wall(0, 2, 3, 0.1), wall(0, -2, 3, 0.1), wall(2, 0, 0.1, 3), wall(-2, 0, 0.1, 3)];
    const p = shortestPath(ring, vec(0, 0), vec(5, 0));
    expect(p.blocked).toBe(true);
    expect(p.length).toBeCloseTo(5, 10);
  });
});
