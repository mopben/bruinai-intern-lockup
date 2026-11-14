import { describe, expect, it } from "vitest";
import { corners, pathLength, penetration, pointAlong, route, segmentEntersRect, standPointOf, toLocal, toWorld, v2, type Rect } from "./geometry";
import { makeStay, makeWalk, positionAt, walkDuration } from "./motion";
import type { Person } from "./people";
import { lognormal, makeRng } from "./rng";

const room = { minX: -10, maxX: 10, minZ: -10, maxZ: 10 };
const square: Rect = { cx: 2, cz: 0, hw: 1, hd: 1, yaw: 0 };

describe("geometry", () => {
  it("rotates like three.js: yaw +90 degrees turns local +z (front) to world +x", () => {
    const r: Rect = { cx: 0, cz: 0, hw: 0.3, hd: 0.2, yaw: Math.PI / 2 };
    const front = toWorld(r, 0, 1);
    expect(front.x).toBeCloseTo(1);
    expect(front.z).toBeCloseTo(0);
    const l = toLocal(r, front);
    expect(l.x).toBeCloseTo(0);
    expect(l.z).toBeCloseTo(1);
    expect(standPointOf(r, "front", 0.35).x).toBeCloseTo(0.55);
    expect(standPointOf(r, "right", 0.35).z).toBeCloseTo(-0.65);
  });

  it("tells inside from outside and edges from crossings", () => {
    expect(penetration(square, v2(2, 0))).toBeCloseTo(1);
    expect(penetration(square, v2(4, 0))).toBeCloseTo(-1);
    expect(segmentEntersRect(square, v2(0, 0), v2(4, 0))).toBe(true);
    expect(segmentEntersRect(square, v2(0, 1), v2(4, 1))).toBe(false);
    expect(segmentEntersRect(square, v2(0, 3), v2(4, 3))).toBe(false);
    expect(corners(square)).toHaveLength(4);
  });

  it("walks straight when clear and around a box when not (known shortest length)", () => {
    expect(route(v2(0, 2), v2(4, 2), [square], room)).toEqual([v2(0, 2), v2(4, 2)]);
    const path = route(v2(0, 0), v2(4, 0), [square], room);
    const g = 1.02; // corners are used 2 cm out from the obstacle
    const expected = 2 * Math.hypot(2 - g, g) + 2 * g;
    expect(path.length).toBe(4);
    expect(pathLength(path)).toBeCloseTo(expected, 6);
    path.slice(1).forEach((p, i) => expect(segmentEntersRect(square, path[i] as typeof p, p)).toBe(false));
    expect(pointAlong(path, 0)).toEqual(v2(0, 0));
    expect(pointAlong(path, 1e9)).toEqual(v2(4, 0));
  });

  it("fails loudly when there is no way through", () => {
    const wall: Rect = { cx: 2, cz: 0, hw: 0.1, hd: 20, yaw: 0 };
    expect(() => route(v2(0, 0), v2(4, 0), [wall], room)).toThrow(/No walkable path/);
  });
});

describe("motion", () => {
  const person = {
    id: "p", name: "P", color: "#000000", speed: 1, accel: 1, decel: 1, skill: 1, tapDelay: 0.3, fumbleChance: 0,
    swayAmp: 0, swayHz: 0.2, swayPhase: [0, 0], habit: { along: 0, out: 0 },
  } as Person;

  it("takes the known time for a trapezoid and a triangle speed profile", () => {
    expect(walkDuration(10, 1, 1, 1)).toBeCloseTo(11);
    expect(walkDuration(0.5, 1, 1, 1)).toBeCloseTo(2 * Math.sqrt(0.5));
    expect(walkDuration(0, 1, 1, 1)).toBe(0);
  });

  it("speeds up, never jumps, and stops at the end", () => {
    const walk = makeWalk(person, [v2(0, 0), v2(10, 0)], 5);
    expect(walk.t1).toBeCloseTo(16);
    const segs = [makeStay(v2(0, 0), 0, 5), walk, makeStay(v2(10, 0), walk.t1, 30)];
    expect(positionAt(person, segs, 5.5).x).toBeCloseTo(0.125);
    expect(positionAt(person, segs, 10.5).x).toBeCloseTo(5);
    expect(positionAt(person, segs, 20).x).toBeCloseTo(10);
    let prev = positionAt(person, segs, 0);
    for (let t = 0.05; t < 30; t += 0.05) {
      const p = positionAt(person, segs, t);
      expect(Math.hypot(p.x - prev.x, p.z - prev.z)).toBeLessThanOrEqual(1 * 0.05 + 1e-9);
      prev = p;
    }
  });
});

describe("rng", () => {
  it("is reproducible and has the right lognormal median", () => {
    const a = makeRng(1);
    const b = makeRng(1);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    const r = makeRng(7);
    const xs = Array.from({ length: 4001 }, () => lognormal(r, 2, 0.3)).sort((x, y) => x - y);
    expect(xs[2000]).toBeGreaterThan(1.9);
    expect(xs[2000]).toBeLessThan(2.1);
  });
});
