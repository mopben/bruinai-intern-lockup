/**
 * Injected time. Feeds never read Date or setTimeout directly, so tests can run
 * a whole 90-second run in microseconds with a manual clock.
 */

export type TimerId = number;

export interface Clock {
  /** Milliseconds on a monotonic scale. Only differences matter. */
  now(): number;
  setTimeout(fn: () => void, ms: number): TimerId;
  clearTimeout(id: TimerId): void;
}

/** The browser's or Node's real clock. */
export const realClock: Clock = {
  now: () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, Math.max(0, ms)) as unknown as TimerId,
  clearTimeout: (id) => globalThis.clearTimeout(id as unknown as ReturnType<typeof globalThis.setTimeout>),
};

export interface ManualClock extends Clock {
  /** Moves time forward, firing due timers in time order. */
  advance(ms: number): void;
  /** Number of timers waiting. */
  pending(): number;
}

interface Timer {
  readonly id: TimerId;
  readonly due: number;
  readonly fn: () => void;
}

/** A clock that only moves when told to. For tests and deterministic tools. */
export function createManualClock(startMs = 0): ManualClock {
  let now = startMs;
  let nextId = 1;
  let timers: readonly Timer[] = [];

  const nextDue = (limit: number): Timer | undefined =>
    timers.filter((t) => t.due <= limit).reduce<Timer | undefined>(
      (best, t) => (best === undefined || t.due < best.due || (t.due === best.due && t.id < best.id) ? t : best),
      undefined,
    );

  return {
    now: () => now,
    setTimeout(fn, ms) {
      const id = nextId++;
      timers = [...timers, { id, due: now + Math.max(0, ms), fn }];
      return id;
    },
    clearTimeout(id) {
      timers = timers.filter((t) => t.id !== id);
    },
    advance(ms) {
      const target = now + ms;
      for (let timer = nextDue(target); timer !== undefined; timer = nextDue(target)) {
        const fired = timer;
        timers = timers.filter((t) => t.id !== fired.id);
        now = Math.max(now, fired.due);
        fired.fn();
      }
      now = target;
    },
    pending: () => timers.length,
  };
}
