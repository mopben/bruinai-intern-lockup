/**
 * How a person moves: walking along a path with a smooth speed profile
 * (speed up, cruise, slow down), or staying in one spot with a slight sway.
 */
import type { Vec2 } from "../../src/core/types";
import { add, pathLength, pointAlong, scale, v2 } from "./geometry";
import type { Person } from "./people";

export interface Walk {
  readonly kind: "walk";
  readonly t0: number;
  readonly t1: number;
  readonly path: readonly Vec2[];
  readonly length: number;
  readonly vmax: number;
  readonly accel: number;
  readonly decel: number;
}

export interface Stay {
  readonly kind: "stay";
  readonly t0: number;
  readonly t1: number;
  readonly at: Vec2;
  /** Leaning toward the counter while working (world offset, m). */
  readonly lean: Vec2;
}

export type Segment = Walk | Stay;

/** Peak speed and phase times for a trapezoid (or triangle) speed profile over length L. */
function profile(L: number, v: number, a: number, b: number): { vp: number; ta: number; tc: number; td: number } {
  const full = (v * v) / (2 * a) + (v * v) / (2 * b);
  if (L >= full) return { vp: v, ta: v / a, tc: (L - full) / v, td: v / b };
  const vp = Math.sqrt((2 * L * a * b) / (a + b));
  return { vp, ta: vp / a, tc: 0, td: vp / b };
}

export function walkDuration(L: number, v: number, a: number, b: number): number {
  if (L <= 1e-9) return 0;
  const p = profile(L, v, a, b);
  return p.ta + p.tc + p.td;
}

/** Distance covered after time t on the profile. */
function distanceAt(w: Walk, t: number): number {
  const p = profile(w.length, w.vmax, w.accel, w.decel);
  const u = Math.max(0, Math.min(t, p.ta + p.tc + p.td));
  if (u <= p.ta) return 0.5 * w.accel * u * u;
  const sa = 0.5 * w.accel * p.ta * p.ta;
  if (u <= p.ta + p.tc) return sa + p.vp * (u - p.ta);
  const r = u - p.ta - p.tc;
  return Math.min(w.length, sa + p.vp * p.tc + p.vp * r - 0.5 * w.decel * r * r);
}

/** A walk for this person along a path, starting at t0. `pace` scales speed for this one leg. */
export function makeWalk(person: Person, path: readonly Vec2[], t0: number, pace = 1): Walk {
  const length = pathLength(path);
  const vmax = person.speed * pace;
  return {
    kind: "walk",
    t0,
    t1: t0 + walkDuration(length, vmax, person.accel, person.decel),
    path,
    length,
    vmax,
    accel: person.accel,
    decel: person.decel,
  };
}

export function makeStay(at: Vec2, t0: number, t1: number, lean: Vec2 = v2(0, 0)): Stay {
  return { kind: "stay", t0, t1, at, lean };
}

function sway(person: Person, t: number): Vec2 {
  const w = 2 * Math.PI * person.swayHz;
  return v2(
    person.swayAmp * Math.sin(w * t + person.swayPhase[0]),
    person.swayAmp * 0.7 * Math.sin(1.37 * w * t + person.swayPhase[1]),
  );
}

/** Where the person really is at time t, given their segments (sorted, back to back). */
export function positionAt(person: Person, segments: readonly Segment[], t: number): Vec2 {
  const seg = segments.find((s) => t >= s.t0 && t < s.t1) ?? segments[segments.length - 1];
  if (!seg) throw new Error(`No movement planned for ${person.id}`);
  if (seg.kind === "walk") return pointAlong(seg.path, distanceAt(seg, t - seg.t0));
  // Ease the lean in and out over a third of a second so nothing jumps.
  const ramp = Math.max(0, Math.min(1, (t - seg.t0) / 0.33, (seg.t1 - t) / 0.33));
  const settle = Math.max(0, Math.min(1, (t - seg.t0) / 0.6, (seg.t1 - t) / 0.6));
  return add(add(seg.at, scale(seg.lean, ramp)), scale(sway(person, t), settle));
}
