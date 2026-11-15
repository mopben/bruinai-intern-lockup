/**
 * The shape of a run, recorded or simulated. The stage animates either one the
 * same way: tickets from `orders` and `queue`, walkers from `movements`.
 */
import type { Vec2 } from "./types";

export interface StepTrace {
  readonly step: number;
  readonly stationId: string;
  /** Who did it, when known. */
  readonly workerId: string | null;
  /**
   * When the item became this step's: release for step 0, else when the previous
   * step was done. This is when its ticket appears at the station.
   */
  readonly arrivedAt: number | null;
  /** When the worker started (fetch walk included). Known in a simulation; null in a recording. */
  readonly startedAt: number | null;
  /** The tap as logged (first tap kept). null when missing. */
  readonly tapAt: number | null;
  /**
   * When the step is known to be done: the earliest tap of this or any later step.
   * Equals tapAt in a clean log. null when neither this nor a later step was tapped.
   */
  readonly doneAt: number | null;
}

export interface OrderTrace {
  readonly orderId: string;
  readonly itemId: string;
  readonly releasedAt: number;
  readonly steps: readonly StepTrace[];
  readonly completed: boolean;
  /** Last step done. null when not completed. */
  readonly finishedAt: number | null;
  /** finishedAt - releasedAt. null when not completed. */
  readonly orderTime: number | null;
}

/** One ticket sitting at one station, from `from` until `to` (null = still there at the end). */
export interface QueueInterval {
  readonly stationId: string;
  readonly orderId: string;
  readonly step: number;
  readonly from: number;
  readonly to: number | null;
}

export interface QueueTimeline {
  /** Stations in menu order. */
  readonly stationIds: readonly string[];
  readonly intervals: readonly QueueInterval[];
  /** Time the run ends. Intervals with to = null are open until here. */
  readonly endT: number;
}

/** "walk": a worker who covers several stations walking between them, or home, with nothing in hand. */
export type MovementKind = "fetch-out" | "fetch-back" | "work" | "carry-out" | "carry-back" | "walk";

/**
 * A worker moving (or working in place) from t0 to t1 along `path` at constant
 * speed. Between segments the worker stands where the last segment ended.
 */
export interface MovementSegment {
  readonly workerId: string;
  readonly orderId: string;
  readonly step: number;
  readonly kind: MovementKind;
  readonly t0: number;
  readonly t1: number;
  /** Polyline; one point for "work". */
  readonly path: readonly Vec2[];
}

export interface RunTrace {
  readonly orders: readonly OrderTrace[];
  readonly queue: QueueTimeline;
  /** Present for simulated runs. Recorded runs use the position log instead. */
  readonly movements: readonly MovementSegment[];
  readonly endT: number;
}
