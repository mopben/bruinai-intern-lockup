/**
 * Pure: smoothing for worker positions that arrive at ~10 Hz with noise.
 * Each displayed pawn chases its latest sample with an exponential filter,
 * turns toward where it is going, and bobs while walking.
 */

/** Time constant of the position filter, seconds. Lower follows faster. */
export const FOLLOW_TAU_S = 0.14;
/** Below this speed (m/s) a pawn counts as standing still. */
export const WALK_SPEED_MIN = 0.18;
/** Above this distance a pawn snaps instead of gliding (e.g. a replay seek). */
export const SNAP_DISTANCE_M = 2.5;

export interface PawnState {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  /** Smoothed speed, m/s. */
  readonly speed: number;
  /** Walk cycle phase, radians. */
  readonly phase: number;
}

/** Fraction of the remaining gap to close in a step of dt seconds. */
export function followAlpha(dt: number, tau = FOLLOW_TAU_S): number {
  if (dt <= 0) return 0;
  return 1 - Math.exp(-dt / tau);
}

/** Shortest signed difference b - a between two angles, in (-pi, pi]. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

export function lerpAngle(a: number, b: number, t: number): number {
  return a + angleDelta(a, b) * t;
}

/** Yaw that makes local +z face the direction (dx, dz). */
export function yawToward(dx: number, dz: number): number {
  return Math.atan2(dx, dz);
}

export function stepPawn(s: PawnState, targetX: number, targetZ: number, dt: number): PawnState {
  if (dt <= 0) return s;
  const gap = Math.hypot(targetX - s.x, targetZ - s.z);
  if (gap > SNAP_DISTANCE_M) return { ...s, x: targetX, z: targetZ, speed: 0 };
  const a = followAlpha(dt);
  const x = s.x + (targetX - s.x) * a;
  const z = s.z + (targetZ - s.z) * a;
  const vx = (x - s.x) / dt;
  const vz = (z - s.z) / dt;
  const rawSpeed = Math.hypot(vx, vz);
  const speed = s.speed + (rawSpeed - s.speed) * followAlpha(dt, 0.2);
  const yaw = rawSpeed > WALK_SPEED_MIN ? lerpAngle(s.yaw, yawToward(vx, vz), followAlpha(dt, 0.12)) : s.yaw;
  const phase = (s.phase + dt * Math.min(speed, 2) * 9) % (Math.PI * 2);
  return { x, z, yaw, speed, phase };
}

/** Vertical bob for a pawn, metres. Zero when standing. */
export function bobHeight(s: PawnState): number {
  const w = Math.min(1, Math.max(0, (s.speed - WALK_SPEED_MIN) / 0.4));
  return Math.abs(Math.sin(s.phase)) * 0.06 * w;
}

/** Springy overshoot ease for things popping in, t in [0,1]. */
export function easeOutBack(t: number, k = 1.9): number {
  const c = Math.min(1, Math.max(0, t)) - 1;
  return 1 + (k + 1) * c * c * c + k * c * c;
}

export function easeOutCubic(t: number): number {
  const c = 1 - Math.min(1, Math.max(0, t));
  return 1 - c * c * c;
}
