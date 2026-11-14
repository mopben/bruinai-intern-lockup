/**
 * Watches live inputs while a run is going and reports when one looks dead.
 *
 * - Link closed for longer than `linkGraceS`: taps and positions are degraded.
 * - No position sample for `positionsSilenceS` (counted from start, then from
 *   the last sample): positions are degraded. Taps are never judged by silence,
 *   because a quiet tablet can be a slow station.
 */
import { realClock, type Clock, type TimerId } from "./clock";
import type { LinkState, MessageLink } from "./socket";

export type InputName = "taps" | "positions";

export interface Degradation {
  readonly input: InputName;
  readonly reason: string;
}

export interface WatchdogOptions {
  readonly clock?: Clock;
  readonly link?: Pick<MessageLink, "state">;
  readonly positionsSilenceS?: number;
  readonly linkGraceS?: number;
  readonly checkEveryMs?: number;
  /** Which inputs to watch right now; inputs on replay are not watched. */
  readonly watching: () => readonly InputName[];
  readonly onDegraded: (problem: Degradation) => void;
}

export interface Watchdog {
  start(): void;
  stop(): void;
  notePosition(): void;
}

export const DEFAULT_POSITIONS_SILENCE_S = 4;
export const DEFAULT_LINK_GRACE_S = 2;

export function createWatchdog(options: WatchdogOptions): Watchdog {
  const clock = options.clock ?? realClock;
  const silenceMs = (options.positionsSilenceS ?? DEFAULT_POSITIONS_SILENCE_S) * 1000;
  const graceMs = (options.linkGraceS ?? DEFAULT_LINK_GRACE_S) * 1000;
  const everyMs = options.checkEveryMs ?? 250;

  let timer: TimerId | undefined;
  let lastPosition = 0;
  let linkDownSince: number | undefined;
  const reported = new Set<InputName>();

  const report = (input: InputName, reason: string) => {
    if (reported.has(input)) return;
    reported.add(input);
    options.onDegraded({ input, reason });
  };

  function check() {
    const now = clock.now();
    const watching = options.watching();
    const linkState: LinkState = options.link?.state() ?? "open";
    linkDownSince = linkState === "open" ? undefined : (linkDownSince ?? now);
    if (linkDownSince !== undefined && now - linkDownSince >= graceMs) {
      const seconds = Math.round((now - linkDownSince) / 1000);
      for (const input of watching) report(input, `lost the connection to the laptop server (${seconds} s)`);
    }
    if (watching.includes("positions") && now - lastPosition >= silenceMs) {
      report("positions", `no camera positions for ${Math.round((now - lastPosition) / 1000)} s`);
    }
  }

  function loop() {
    check();
    timer = clock.setTimeout(loop, everyMs);
  }

  return {
    start() {
      if (timer !== undefined) return;
      lastPosition = clock.now();
      linkDownSince = undefined;
      reported.clear();
      timer = clock.setTimeout(loop, everyMs);
    },
    stop() {
      if (timer !== undefined) clock.clearTimeout(timer);
      timer = undefined;
    },
    notePosition() {
      lastPosition = clock.now();
      reported.delete("positions");
    },
  };
}
