import { describe, expect, it } from "vitest";
import { DEFAULT_TRACKER, LOST, recorded, reported, stepTrack, type WorkerTrack } from "./tracker";

const run = (steps: readonly [number, { x: number; z: number } | undefined][]): WorkerTrack[] => {
  const out: WorkerTrack[] = [];
  let tr = LOST;
  for (const [t, obs] of steps) {
    tr = stepTrack(tr, t, obs);
    out.push(tr);
  }
  return out;
};

describe("stepTrack", () => {
  it("locks on the first sighting without smoothing", () => {
    const [a] = run([[0, { x: 1, z: 2 }]]);
    expect(a).toMatchObject({ status: "locked", pos: { x: 1, z: 2 } });
  });

  it("takes alpha of a first small move", () => {
    const s = run([[0, { x: 0, z: 0 }], [0.1, { x: 0.1, z: 0 }]]);
    expect(s[1]!.pos!.x).toBeCloseTo(0.1 * DEFAULT_TRACKER.alpha, 9);
  });

  it("follows a steady walk with no lasting lag", () => {
    const steps: [number, { x: number; z: number }][] = Array.from({ length: 40 }, (_, i) => [i * 0.1, { x: 1.2 * i * 0.1, z: 0 }]);
    const s = run(steps);
    expect(Math.abs(s[39]!.pos!.x - 1.2 * 3.9)).toBeLessThan(0.01);
    expect(s[39]!.vel!.x).toBeCloseTo(1.2, 2);
  });

  it("damps jitter around a standing person", () => {
    const noise = [0.03, -0.02, 0.025, -0.03, 0.02, -0.025, 0.03, -0.02, 0.02, -0.03];
    const s = run(noise.map((n, i) => [i * 0.1, { x: 1 + n, z: 1 }] as [number, { x: number; z: number }]));
    const spread = Math.max(...s.slice(3).map((t) => Math.abs(t.pos!.x - 1)));
    expect(spread).toBeLessThan(0.03);
  });

  it("holds the last position for up to 0.5 s, then reports nothing", () => {
    const s = run([[0, { x: 1, z: 1 }], [0.3, undefined], [0.5, undefined], [0.51, undefined]]);
    expect(s[1]).toMatchObject({ status: "holding", pos: { x: 1, z: 1 } });
    expect(reported(s[1]!)).toEqual({ x: 1, z: 1 });
    expect(recorded(s[1]!)).toBeUndefined();
    expect(s[2]!.status).toBe("holding");
    expect(s[3]!.status).toBe("lost");
    expect(reported(s[3]!)).toBeUndefined();
  });

  it("snaps to the next sighting after a hold (the held point is stale)", () => {
    const s = run([[0, { x: 1, z: 1 }], [0.1, undefined], [0.2, undefined], [0.3, { x: 1.4, z: 1 }]]);
    expect(s[3]).toMatchObject({ status: "locked", pos: { x: 1.4, z: 1 } });
  });

  it("re-locks without smoothing after being lost", () => {
    const s = run([[0, { x: 1, z: 1 }], [1, undefined], [1.1, { x: 3, z: 3 }]]);
    expect(s[2]).toMatchObject({ status: "locked", pos: { x: 3, z: 3 } });
  });

  it("ignores a one-frame jump, accepts it when it persists", () => {
    const s = run([[0, { x: 1, z: 1 }], [0.1, { x: 3, z: 1 }], [0.2, { x: 1, z: 1 }], [0.3, { x: 3, z: 1 }], [0.4, { x: 3.05, z: 1 }]]);
    expect(s[1]).toMatchObject({ status: "holding", pos: { x: 1, z: 1 } });
    expect(s[2]!.pos!.x).toBeCloseTo(1);
    expect(s[3]!.status).toBe("holding");
    expect(s[4]).toMatchObject({ status: "locked", pos: { x: 3.05, z: 1 } });
  });

  it("does not mutate the input track", () => {
    const tr = Object.freeze(stepTrack(LOST, 0, { x: 1, z: 1 }));
    expect(() => stepTrack(tr, 0.1, { x: 1.1, z: 1 })).not.toThrow();
    expect(tr.pos).toEqual({ x: 1, z: 1 });
  });
});
