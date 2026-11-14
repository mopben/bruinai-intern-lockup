import { describe, expect, it } from "vitest";
import { resolveMove, clampToArea, overlaps, CONTACT_GAP_M } from "./collision";
import { frameRoom, cameraAxes, viewDir, DEFAULT_VIEW } from "./framing";
import {
  dragArea,
  footprintHalf,
  lockReason,
  nextQuarterTurn,
  resolveItems,
  roomBounds,
  withPlacement,
} from "./model";
import { angleDelta, followAlpha, stepPawn, SNAP_DISTANCE_M, easeOutBack } from "./smoothing";
import { sampleKitchen, sampleLayout, SAMPLE_IDS } from "./sample-kitchen";

const area = { minX: -2, maxX: 2, minZ: -1, maxZ: 1 };

describe("model", () => {
  it("resolves names, roles and placements with layout overriding the scan", () => {
    const layout = withPlacement(sampleLayout, SAMPLE_IDS.fridge, { x: 0, z: 0, yaw: 0 });
    const items = resolveItems({ ...sampleKitchen, layout });
    const fridge = items.find((i) => i.id === SAMPLE_IDS.fridge)!;
    expect(fridge.name).toBe("Milk fridge");
    expect(fridge.role).toBe("storage");
    expect([fridge.x, fridge.z]).toEqual([0, 0]);
    const make = items.find((i) => i.id === SAMPLE_IDS.make)!;
    expect(make.locked).toBe(true);
    expect(make.x).toBeCloseTo(0.35);
  });

  it("falls back to the scan category when there is no setup", () => {
    const items = resolveItems({ scan: sampleKitchen.scan });
    expect(items[0]!.name).toBe("table");
    expect(items[0]!.unnamed).toBe(true);
  });

  it("withPlacement returns a new layout and leaves the input alone", () => {
    const before = JSON.stringify(sampleLayout);
    const next = withPlacement(sampleLayout, "a", { x: 1, z: 2, yaw: 0 });
    expect(next).not.toBe(sampleLayout);
    expect(next.placements).not.toBe(sampleLayout.placements);
    expect(next.placements.a).toEqual({ x: 1, z: 2, yaw: 0 });
    expect(JSON.stringify(sampleLayout)).toBe(before);
  });

  it("room bounds cover the walls: 4.5 m by 3.5 m", () => {
    const b = roomBounds(sampleKitchen);
    expect(b.maxX - b.minX).toBeCloseTo(4.5, 1);
    expect(b.maxZ - b.minZ).toBeCloseTo(3.5, 1);
  });

  it("drag area excludes wall thickness on walled sides only", () => {
    const b = roomBounds(sampleKitchen);
    const d = dragArea(sampleKitchen);
    expect(d.minZ).toBeCloseTo(-1.65);
    expect(d.minX).toBeCloseTo(-2.15);
    expect(d.maxX).toBeCloseTo(b.maxX);
    expect(d.maxZ).toBeCloseTo(b.maxZ);
  });

  it("footprint swaps extents at a quarter turn", () => {
    const f = footprintHalf({ w: 2, h: 1, d: 1 }, Math.PI / 2);
    expect(f.hx).toBeCloseTo(0.5);
    expect(f.hz).toBeCloseTo(1);
  });

  it("quarter turns cycle", () => {
    expect(nextQuarterTurn(0)).toBeCloseTo(Math.PI / 2);
    expect(nextQuarterTurn((3 * Math.PI) / 2)).toBeCloseTo(0);
    expect(nextQuarterTurn(0.1)).toBeCloseTo(Math.PI / 2);
  });

  it("says why a locked thing is fixed", () => {
    expect(lockReason({ name: "Sink", category: "sink" })).toBe("Fixed: plumbing");
    expect(lockReason({ name: "Make", category: "storage" })).toBe("Fixed: power");
  });
});

describe("collision", () => {
  const ob = { minX: 0, maxX: 1, minZ: -0.5, maxZ: 0.5 };

  it("clamps inside the area", () => {
    expect(clampToArea(5, -5, 0.5, 0.25, area)).toEqual({ x: 1.5, z: -0.75 });
  });

  it("moves freely when the target is empty", () => {
    const r = resolveMove({ hx: 0.2, hz: 0.2, from: { x: -1, z: 0 }, to: { x: -1.5, z: 0.3 }, area, obstacles: [ob] });
    expect(r).toEqual({ x: -1.5, z: 0.3 });
  });

  it("stops at the face of an obstacle with a small gap", () => {
    const r = resolveMove({ hx: 0.2, hz: 0.2, from: { x: -1, z: 0 }, to: { x: 0.3, z: 0 }, area, obstacles: [ob] });
    expect(r.x).toBeCloseTo(-0.2 - CONTACT_GAP_M);
    expect(r.z).toBeCloseTo(0);
  });

  it("slides along an obstacle instead of sticking", () => {
    const r = resolveMove({ hx: 0.2, hz: 0.2, from: { x: -1, z: 0 }, to: { x: 0.2, z: 0.4 }, area, obstacles: [ob] });
    expect(r.z).toBeCloseTo(0.4);
    expect(r.x).toBeCloseTo(-0.2 - CONTACT_GAP_M);
  });

  it("jumps to a free spot on the far side under the pointer", () => {
    const r = resolveMove({ hx: 0.2, hz: 0.2, from: { x: -1, z: 0 }, to: { x: 1.5, z: 0 }, area, obstacles: [ob] });
    expect(r).toEqual({ x: 1.5, z: 0 });
  });

  it("is stable: the same blocked request gives the same answer twice", () => {
    const req = { hx: 0.2, hz: 0.2, from: { x: -1, z: 0 }, to: { x: 0.5, z: 0.1 }, area, obstacles: [ob] };
    const a = resolveMove(req);
    const b = resolveMove({ ...req, from: a });
    expect(b.x).toBeCloseTo(a.x);
    expect(b.z).toBeCloseTo(a.z);
  });

  it("never ends overlapping an obstacle", () => {
    for (let i = 0; i < 200; i++) {
      const to = { x: Math.sin(i * 1.7) * 2, z: Math.cos(i * 2.3) };
      const r = resolveMove({ hx: 0.3, hz: 0.2, from: { x: -1.5, z: 0.7 }, to, area, obstacles: [ob] });
      const rect = { minX: r.x - 0.3, maxX: r.x + 0.3, minZ: r.z - 0.2, maxZ: r.z + 0.2 };
      expect(overlaps(rect, ob)).toBe(false);
    }
  });

  it("lets a box that starts overlapping move out", () => {
    const r = resolveMove({ hx: 0.2, hz: 0.2, from: { x: 0.1, z: 0 }, to: { x: -0.8, z: 0 }, area, obstacles: [ob] });
    expect(r.x).toBeCloseTo(-0.8);
  });
});

describe("framing", () => {
  const room = { minX: -2.25, maxX: 2.25, minZ: -1.75, maxZ: 1.75 };

  it("camera axes are orthonormal", () => {
    const { right, up } = cameraAxes(viewDir(DEFAULT_VIEW));
    expect(Math.hypot(right.x, right.y, right.z)).toBeCloseTo(1);
    expect(Math.hypot(up.x, up.y, up.z)).toBeCloseTo(1);
    expect(right.y).toBeCloseTo(0);
    expect(up.y).toBeGreaterThan(0);
  });

  it("keeps the aspect ratio of the viewport", () => {
    for (const aspect of [16 / 9, 8 / 9, 0.5, 3]) {
      const f = frameRoom(room, aspect);
      expect(f.halfW / f.halfH).toBeCloseTo(aspect);
    }
  });

  it("fits every room corner inside the frame with a margin", () => {
    for (const aspect of [16 / 9, 0.8]) {
      const f = frameRoom(room, aspect, { margin: 0.1, height: 1.2 });
      const { right, up } = cameraAxes(f.dir);
      for (const x of [room.minX, room.maxX]) {
        for (const z of [room.minZ, room.maxZ]) {
          for (const y of [0, 1.2]) {
            const dx = x - f.target.x;
            const dy = y - f.target.y;
            const dz = z - f.target.z;
            const u = dx * right.x + dy * right.y + dz * right.z;
            const v = dx * up.x + dy * up.y + dz * up.z;
            expect(Math.abs(u)).toBeLessThanOrEqual(f.halfW * 0.8 + 1e-6);
            expect(Math.abs(v)).toBeLessThanOrEqual(f.halfH * 0.8 + 1e-6);
          }
        }
      }
    }
  });

  it("a narrower viewport needs a taller frustum", () => {
    expect(frameRoom(room, 0.8).halfH).toBeGreaterThan(frameRoom(room, 16 / 9).halfH);
  });
});

describe("smoothing", () => {
  it("follow alpha is 0 at dt 0 and approaches 1", () => {
    expect(followAlpha(0)).toBe(0);
    expect(followAlpha(10)).toBeCloseTo(1);
  });

  it("is frame-rate independent", () => {
    let a = { x: 0, z: 0, yaw: 0, speed: 0, phase: 0 };
    let b = { ...a };
    for (let i = 0; i < 60; i++) a = stepPawn(a, 1, 0, 1 / 60);
    for (let i = 0; i < 30; i++) b = stepPawn(b, 1, 0, 1 / 30);
    expect(a.x).toBeCloseTo(b.x, 3);
  });

  it("faces the direction of travel", () => {
    let s = { x: 0, z: 0, yaw: 0, speed: 0, phase: 0 };
    for (let i = 0; i < 60; i++) s = stepPawn(s, s.x + 0.05, 0, 1 / 60);
    expect(s.yaw).toBeCloseTo(Math.PI / 2, 1);
  });

  it("snaps on a long jump", () => {
    const s = stepPawn({ x: 0, z: 0, yaw: 0, speed: 0, phase: 0 }, SNAP_DISTANCE_M + 1, 0, 1 / 60);
    expect(s.x).toBe(SNAP_DISTANCE_M + 1);
  });

  it("angle delta takes the short way round", () => {
    expect(angleDelta(3, -3)).toBeCloseTo(2 * Math.PI - 6);
    expect(angleDelta(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2);
  });

  it("easeOutBack starts at 0, ends at 1, overshoots", () => {
    expect(easeOutBack(0)).toBeCloseTo(0);
    expect(easeOutBack(1)).toBeCloseTo(1);
    expect(Math.max(...[0.5, 0.6, 0.7, 0.8].map((t) => easeOutBack(t)))).toBeGreaterThan(1);
  });
});

import { dashLayout, polylineMidpoint } from "./floor-marks";
describe("floor marks", () => {
  it("lays dashes along a straight line at a fixed pitch", () => {
    const d = dashLayout([{ x: 0, z: 0 }, { x: 1, z: 0 }], 0.16, 0.1);
    expect(d.length).toBe(4);
    expect(d[0]!.x).toBeCloseTo(0.08);
    expect(d[1]!.x).toBeCloseTo(0.34);
    expect(d[0]!.yaw).toBeCloseTo(Math.PI / 2);
  });
  it("carries the dash phase around corners", () => {
    const d = dashLayout([{ x: 0, z: 0 }, { x: 0.2, z: 0 }, { x: 0.2, z: 1 }], 0.16, 0.1);
    expect(d[1]!.x).toBeCloseTo(0.2);
    expect(d[1]!.z).toBeCloseTo(0.14);
  });
  it("finds the midpoint by length", () => {
    expect(polylineMidpoint([{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 2, z: 2 }])).toEqual({ x: 2, z: 0 });
    expect(polylineMidpoint([])).toBeNull();
  });
});
