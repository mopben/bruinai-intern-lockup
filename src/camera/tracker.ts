/**
 * Per-worker smoothing and gap rules, in floor metres. Pure: time is passed in.
 *
 * - Seen: an alpha-beta filter (position and velocity). Plain exponential
 *   smoothing lags a walking person by speed x time constant (about 14 cm at
 *   1.2 m/s with tau 0.12 s, measured on the synthetic video); a constant-
 *   velocity filter has no steady lag while still damping per-frame jitter.
 *   Velocity is clamped to a brisk walk.
 * - A jump of more than `jumpM` from the current position is not believed at
 *   once (a stray blob); it must be seen `confirmFrames` frames in a row near
 *   the same place, then the dot snaps there.
 * - Not seen: hold the last position (no extrapolation) for at most `holdS`,
 *   then report nothing. We never invent positions; the stage's watchdog
 *   handles silence. After a hold the next sighting snaps (the held point is
 *   stale) and the velocity starts again from zero.
 */
import type { Vec2 } from "../core/types";

export type TrackStatus = "locked" | "holding" | "lost";

export interface WorkerTrack {
  readonly status: TrackStatus;
  readonly pos?: Vec2;
  readonly vel?: Vec2;
  readonly lastSeen?: number;
  readonly lastT?: number;
  readonly pending?: { readonly pos: Vec2; readonly count: number };
}

export interface TrackerOptions {
  /** Share of the residual taken into position (0..1). */
  readonly alpha: number;
  /** Share of the residual (per second) taken into velocity. */
  readonly beta: number;
  readonly maxSpeed: number;
  readonly holdS: number;
  readonly jumpM: number;
  readonly confirmFrames: number;
}

export const DEFAULT_TRACKER: TrackerOptions = { alpha: 0.6, beta: 0.25, maxSpeed: 2.5, holdS: 0.5, jumpM: 0.9, confirmFrames: 2 };
export const LOST: WorkerTrack = { status: "lost" };

const ZERO: Vec2 = { x: 0, z: 0 };
const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);

function clampSpeed(v: Vec2, max: number): Vec2 {
  const s = Math.hypot(v.x, v.z);
  return s <= max ? v : { x: (v.x * max) / s, z: (v.z * max) / s };
}

function unseen(track: WorkerTrack, t: number, o: TrackerOptions, pending?: WorkerTrack["pending"]): WorkerTrack {
  if (track.pos && track.lastSeen !== undefined && t - track.lastSeen <= o.holdS) {
    return { status: "holding", pos: track.pos, vel: ZERO, lastSeen: track.lastSeen, lastT: t, pending };
  }
  return { status: "lost", lastT: t, pending };
}

const fresh = (obs: Vec2, t: number): WorkerTrack => ({ status: "locked", pos: obs, vel: ZERO, lastSeen: t, lastT: t });

export function stepTrack(track: WorkerTrack, t: number, obs: Vec2 | undefined, o: TrackerOptions = DEFAULT_TRACKER): WorkerTrack {
  if (!obs) return unseen(track, t, o);
  if (track.status === "lost" || !track.pos) return fresh(obs, t);
  if (dist(obs, track.pos) > o.jumpM) {
    const p = track.pending;
    const count = p && dist(p.pos, obs) < o.jumpM / 2 ? p.count + 1 : 1;
    if (count >= o.confirmFrames) return fresh(obs, t);
    return unseen(track, t, o, { pos: obs, count });
  }
  if (track.status === "holding") return fresh(obs, t);
  const dt = Math.max(0, t - (track.lastT ?? t));
  const v = track.vel ?? ZERO;
  const pred = { x: track.pos.x + v.x * dt, z: track.pos.z + v.z * dt };
  const r = { x: obs.x - pred.x, z: obs.z - pred.z };
  const pos = { x: pred.x + o.alpha * r.x, z: pred.z + o.alpha * r.z };
  const vel = dt > 0 ? clampSpeed({ x: v.x + (o.beta * r.x) / dt, z: v.z + (o.beta * r.z) / dt }, o.maxSpeed) : v;
  return { status: "locked", pos, vel, lastSeen: t, lastT: t };
}

/** The position to send live, if any (locked or briefly held). */
export const reported = (track: WorkerTrack): Vec2 | undefined => (track.status === "lost" ? undefined : track.pos);

/** The position to write to a file: only fresh sightings; a gap is better than a stale point. */
export const recorded = (track: WorkerTrack): Vec2 | undefined => (track.status === "locked" ? track.pos : undefined);
