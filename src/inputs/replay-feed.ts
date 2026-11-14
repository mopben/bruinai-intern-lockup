/**
 * Replay: plays a recorded run's taps and positions against a clock.
 */
import type { PositionSample, RunBundle, TapEvent } from "../core/types";
import { realClock, type Clock, type TimerId } from "./clock";
import { createFeedCore, type ReplayRunFeed } from "./feed";

export interface ReplayOptions {
  readonly clock?: Clock;
  /** Initial speed multiplier. Default 1. */
  readonly speed?: number;
}

type Item =
  | { readonly kind: "tap"; readonly t: number; readonly event: TapEvent }
  | { readonly kind: "pos"; readonly t: number; readonly sample: PositionSample };

/** Merges taps and positions into one time line. At equal t, taps come first. */
function timeline(taps: readonly TapEvent[], positions: readonly PositionSample[]): readonly Item[] {
  const lastT = Math.max(0, ...taps.map((e) => e.t), ...positions.map((p) => p.t));
  const hasEnd = taps.some((e) => e.type === "end");
  const withEnd: readonly TapEvent[] = hasEnd ? taps : [...taps, { type: "end", t: lastT }];
  const items: Item[] = [
    ...withEnd.map((event) => ({ kind: "tap" as const, t: event.t, event })),
    ...positions.map((sample) => ({ kind: "pos" as const, t: sample.t, sample })),
  ];
  const rank = (item: Item) => (item.kind === "tap" ? (item.event.type === "end" ? 2 : 0) : 1);
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => a.item.t - b.item.t || rank(a.item) - rank(b.item) || a.i - b.i)
    .map(({ item }) => item);
}

function checkSpeed(multiplier: number): number {
  if (!Number.isFinite(multiplier) || multiplier <= 0) {
    throw new RangeError(`Replay speed must be a positive number, got ${multiplier}`);
  }
  return multiplier;
}

/** Plays `bundle.taps` and `bundle.positions`. Only the logs are used; the rest of the bundle is ignored. */
export function createReplayFeed(
  bundle: Pick<RunBundle, "taps" | "positions">,
  options: ReplayOptions = {},
): ReplayRunFeed {
  const clock = options.clock ?? realClock;
  const items = timeline(bundle.taps, bundle.positions);
  const duration = items[items.length - 1]?.t ?? 0;
  const core = createFeedCore();

  let speed = checkSpeed(options.speed ?? 1);
  let paused = false;
  let next = 0;
  // Run time = baseT + (clock.now() - baseWall) * speed, while playing.
  let baseT = 0;
  let baseWall = 0;
  let timer: TimerId | undefined;
  let endDelivered = false;

  const playing = () => core.status() === "running" && !paused;
  const now = (): number => {
    if (!playing()) return baseT;
    return Math.min(duration, baseT + ((clock.now() - baseWall) / 1000) * speed);
  };
  const rebase = () => {
    baseT = now();
    baseWall = clock.now();
  };
  const cancelTimer = () => {
    if (timer !== undefined) clock.clearTimeout(timer);
    timer = undefined;
  };

  const deliverUpTo = (t: number) => {
    while (next < items.length && (items[next]?.t ?? Infinity) <= t) {
      const item = items[next] as Item;
      next += 1;
      if (item.kind === "tap") {
        endDelivered = endDelivered || item.event.type === "end";
        core.deliverTap(item.event);
      }
      else core.deliverPosition(item.sample);
    }
    if (next >= items.length) finish();
  };

  function finish() {
    cancelTimer();
    baseT = duration;
    core.setStatus("ended");
  }

  function schedule() {
    cancelTimer();
    if (!playing()) return;
    const item = items[next];
    if (item === undefined) return finish();
    const waitMs = Math.max(0, ((item.t - now()) / speed) * 1000);
    timer = clock.setTimeout(tick, waitMs);
  }

  function tick() {
    timer = undefined;
    if (!playing()) return;
    deliverUpTo(now());
    schedule();
  }

  return {
    kind: "replay",
    start() {
      if (core.status() !== "idle") return;
      baseT = 0;
      baseWall = clock.now();
      core.setStatus("running");
      deliverUpTo(0);
      schedule();
    },
    stop() {
      if (core.status() !== "running") return;
      const t = now();
      cancelTimer();
      baseT = t;
      // Deliver what is due, then a closing end at the current time.
      deliverUpTo(t);
      if (core.status() === "running") {
        next = items.length;
        if (!endDelivered) core.deliverTap({ type: "end", t });
        endDelivered = true;
        core.setStatus("ended");
      }
    },
    now,
    status: core.status,
    error: core.error,
    onTap: core.onTap,
    onPosition: core.onPosition,
    onStatus: core.onStatus,
    delivered: core.delivered,
    duration: () => duration,
    speed: () => speed,
    setSpeed(multiplier) {
      const checked = checkSpeed(multiplier);
      rebase();
      speed = checked;
      schedule();
    },
    pause() {
      if (paused || core.status() !== "running") return;
      rebase();
      paused = true;
      cancelTimer();
    },
    resume() {
      if (!paused) return;
      paused = false;
      baseWall = clock.now();
      schedule();
    },
    isPaused: () => paused,
    seek(t) {
      if (core.status() !== "running" || t <= now()) return;
      const target = Math.min(duration, t);
      baseT = target;
      baseWall = clock.now();
      deliverUpTo(target);
      schedule();
    },
    skipToEnd() {
      if (core.status() === "idle") {
        baseWall = clock.now();
        core.setStatus("running");
      }
      if (core.status() !== "running") return;
      deliverUpTo(Infinity);
    },
  };
}
