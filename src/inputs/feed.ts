/**
 * The one interface every consumer of taps and positions uses.
 *
 * A RunFeed delivers TapEvents and PositionSamples in time order, each exactly
 * once, with `t` in seconds of run time. Whether the events come from a file
 * (replay) or from the tablet and the camera (live) is visible only in `kind`;
 * nothing downstream should branch on it.
 *
 * Guarantees for every implementation:
 * - Taps are delivered with non-decreasing t; positions likewise.
 * - The last tap delivered is always { type: "end" }, after which status is "ended".
 * - Listeners added late do not get past events; read delivered() for those.
 */
import type { PositionSample, TapEvent } from "../core/types";
import type { Unsubscribe } from "./socket";

export type FeedKind = "live" | "replay";
export type FeedStatus = "idle" | "running" | "ended" | "failed";

export interface Delivered {
  readonly taps: readonly TapEvent[];
  readonly positions: readonly PositionSample[];
}

export interface RunFeed {
  readonly kind: FeedKind;
  /** Starts the run clock at t = 0. Calling it twice does nothing. */
  start(): void;
  /** Ends the run now: delivers { type: "end", t: now() } and stops. */
  stop(): void;
  /** Current run time in seconds (0 before start, frozen after end). */
  now(): number;
  status(): FeedStatus;
  /** Why the feed failed, if status is "failed". */
  error(): string | undefined;
  onTap(listener: (event: TapEvent) => void): Unsubscribe;
  onPosition(listener: (sample: PositionSample) => void): Unsubscribe;
  onStatus(listener: (status: FeedStatus) => void): Unsubscribe;
  /** Everything delivered so far, in order. */
  delivered(): Delivered;
}

/** Replay adds playback controls. */
export interface ReplayRunFeed extends RunFeed {
  readonly kind: "replay";
  /** Run time of the last event (the "end" line if present). */
  duration(): number;
  speed(): number;
  /** 1 = real time, 4 = four times faster. Takes effect at once. */
  setSpeed(multiplier: number): void;
  pause(): void;
  resume(): void;
  isPaused(): boolean;
  /**
   * Jumps forward to run time t, delivering every event up to t in order.
   * Seeking backwards is not possible (events cannot be taken back): make a new feed.
   */
  seek(t: number): void;
  /** Delivers all remaining events in order and ends. */
  skipToEnd(): void;
}

/** A small listener list. Listeners are called in the order they were added. */
export function createEmitter<T>() {
  let listeners: readonly ((value: T) => void)[] = [];
  return {
    add(fn: (value: T) => void): Unsubscribe {
      listeners = [...listeners, fn];
      return () => {
        listeners = listeners.filter((f) => f !== fn);
      };
    },
    emit(value: T) {
      for (const fn of listeners) fn(value);
    },
  };
}

/** Shared bookkeeping for feeds: status, delivered lists and listeners. */
export function createFeedCore() {
  const taps = createEmitter<TapEvent>();
  const positions = createEmitter<PositionSample>();
  const statuses = createEmitter<FeedStatus>();
  let status: FeedStatus = "idle";
  let error: string | undefined;
  // Private append-only logs; delivered() hands out frozen snapshots, so
  // callers never see later appends and a long run stays O(n).
  const tapLog: TapEvent[] = [];
  const positionLog: PositionSample[] = [];
  let snapshot: Delivered | undefined;

  return {
    status: () => status,
    error: () => error,
    delivered(): Delivered {
      snapshot ??= Object.freeze({
        taps: Object.freeze(tapLog.slice()),
        positions: Object.freeze(positionLog.slice()),
      });
      return snapshot;
    },
    setStatus(next: FeedStatus, reason?: string) {
      if (next === status) return;
      status = next;
      error = next === "failed" ? reason : undefined;
      statuses.emit(next);
    },
    deliverTap(event: TapEvent) {
      tapLog.push(event);
      snapshot = undefined;
      taps.emit(event);
    },
    deliverPosition(sample: PositionSample) {
      positionLog.push(sample);
      snapshot = undefined;
      positions.emit(sample);
    },
    onTap: taps.add,
    onPosition: positions.add,
    onStatus: statuses.add,
  };
}
