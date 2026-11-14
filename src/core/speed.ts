/**
 * Instantaneous walking speed from the position log: the fallback when no whole
 * trips can be found (see pace.ts).
 */
import type { PositionSample } from "./types";
import { median } from "./stats";

/** Walking speed used when there is no usable position log. Stated in the UI as assumed. */
export const DEFAULT_WALK_SPEED_MPS = 1.2;
/** Displacement is measured over this window to beat position noise. */
export const SPEED_WINDOW_S = 0.5;
/** Window speeds below this count as standing, not walking. */
export const MOVING_THRESHOLD_MPS = 0.4;
/** Gaps in the position log longer than this are not bridged. */
export const MAX_POSITION_GAP_S = 2;
/** Fewer moving windows than this: fall back to the default speed. */
export const MIN_SPEED_SAMPLES = 5;
export interface SpeedEstimate {
  readonly mps: number;
  /** True when the default was used because the position log had too little walking. */
  readonly assumed: boolean;
  readonly samples: number;
}

function windowSpeeds(samples: readonly PositionSample[]): number[] {
  const out: number[] = [];
  let j = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const a = samples[i] as PositionSample;
    if (j <= i) j = i + 1;
    while (j < samples.length && (samples[j] as PositionSample).t - a.t < SPEED_WINDOW_S) j += 1;
    const b = samples[j];
    if (!b) break;
    const dt = b.t - a.t;
    if (dt > MAX_POSITION_GAP_S) continue;
    out.push(Math.hypot(b.x - a.x, b.z - a.z) / dt);
  }
  return out;
}

/** Robust walking speed: median of windowed speeds above the movement threshold, across workers. */
export function estimateWalkSpeed(positions: readonly PositionSample[]): SpeedEstimate {
  const byWorker = new Map<string, PositionSample[]>();
  for (const p of positions) {
    if (!Number.isFinite(p.t) || !Number.isFinite(p.x) || !Number.isFinite(p.z)) continue;
    const list = byWorker.get(p.workerId) ?? [];
    list.push(p);
    byWorker.set(p.workerId, list);
  }
  const moving = [...byWorker.values()]
    .flatMap((list) => windowSpeeds([...list].sort((a, b) => a.t - b.t)))
    .filter((v) => v > MOVING_THRESHOLD_MPS);
  if (moving.length < MIN_SPEED_SAMPLES) return { mps: DEFAULT_WALK_SPEED_MPS, assumed: true, samples: moving.length };
  return { mps: median(moving), assumed: false, samples: moving.length };
}
