/**
 * Failover without restart.
 *
 * A SwitchableRunFeed runs a live feed and a recorded (replay) feed side by side
 * on the same clock, and forwards each input (taps, positions) from whichever
 * source is selected for it. Switching an input mid-run continues at the current
 * run time: the newly selected source only contributes events from now on, and
 * an event already delivered (same order released, same order step done) is
 * never delivered twice.
 *
 * Catch-up: when taps switch to the recording, recorded tap events from before
 * now that were never delivered are delivered at once, in order, with their
 * recorded t. Without this an order could show step 2 done but never step 0.
 * These catch-up events are the one place where a tap's t can be lower than
 * the previous tap's. Turn it off with `catchUp: false`.
 *
 * A watchdog marks a live input "degraded" with a reason; with autoFailover
 * (default) the input is then switched to the recording and marked "replaced".
 * Positions failing never touches live taps.
 */
import type { PositionSample, TapEvent } from "../core/types";
import { realClock, type Clock } from "./clock";
import { createFeedCore, createEmitter, type FeedKind, type RunFeed } from "./feed";
import type { MessageLink, Unsubscribe } from "./socket";
import { createWatchdog, type Degradation, type InputName } from "./watchdog";

export type { InputName } from "./watchdog";
export type SourceKind = "live" | "replay";
export type Sources = Readonly<Record<InputName, SourceKind>>;

export interface InputHealth {
  readonly input: InputName;
  readonly source: SourceKind;
  /** ok; degraded = live input looks dead; replaced = was degraded, now fed from the recording. */
  readonly state: "ok" | "degraded" | "replaced";
  readonly reason?: string;
}

export interface SwitchableOptions {
  readonly live: RunFeed;
  /** Normally a replay feed of the recorded run with the same setup. */
  readonly recorded: RunFeed;
  readonly sources?: Partial<Sources>;
  readonly clock?: Clock;
  /** Link the live feed uses, so the watchdog can see it close. */
  readonly link?: Pick<MessageLink, "state">;
  readonly autoFailover?: boolean;
  readonly positionsSilenceS?: number;
  readonly linkGraceS?: number;
  /** Deliver the recording's missed earlier taps when switching taps to it. Default true. */
  readonly catchUp?: boolean;
}

export interface SwitchableRunFeed extends RunFeed {
  /** "live" while any input is live. */
  readonly kind: FeedKind;
  sources(): Sources;
  /** Switch one input, now, without restarting. */
  setSource(input: InputName, source: SourceKind): void;
  health(): readonly InputHealth[];
  onHealth(listener: (health: readonly InputHealth[]) => void): Unsubscribe;
}

const INPUTS: readonly InputName[] = ["taps", "positions"];

function tapKey(event: TapEvent): string {
  if (event.type === "order") return `order:${event.orderId}`;
  if (event.type === "done") return `done:${event.orderId}#${event.step}`;
  return "end";
}

export function createSwitchableFeed(options: SwitchableOptions): SwitchableRunFeed {
  const { live, recorded } = options;
  const clock = options.clock ?? realClock;
  const autoFailover = options.autoFailover ?? true;
  const core = createFeedCore();
  const healthEvents = createEmitter<readonly InputHealth[]>();

  let sources: Sources = { taps: options.sources?.taps ?? "live", positions: options.sources?.positions ?? "live" };
  let problems: ReadonlyMap<InputName, Degradation & { readonly replaced: boolean }> = new Map();
  const deliveredKeys = new Set<string>();
  let lastTapT = 0;
  let lastPosT = 0;
  let endT = 0;

  const feedFor = (source: SourceKind) => (source === "live" ? live : recorded);

  const health = (): readonly InputHealth[] =>
    INPUTS.map((input) => {
      const problem = problems.get(input);
      if (problem === undefined) return { input, source: sources[input], state: "ok" as const };
      return { input, source: sources[input], state: problem.replaced ? "replaced" : "degraded", reason: problem.reason };
    });
  const announceHealth = () => healthEvents.emit(health());

  const now = () => (core.status() === "running" ? feedFor(sources.taps).now() : endT);

  function forwardTap(from: SourceKind, event: TapEvent) {
    if (core.status() !== "running" || sources.taps !== from) return;
    const key = tapKey(event);
    if (deliveredKeys.has(key)) return;
    deliveredKeys.add(key);
    const t = Math.max(event.t, lastTapT);
    lastTapT = t;
    if (event.type === "end") return finish(t);
    core.deliverTap(t === event.t ? event : { ...event, t });
  }

  function catchUpFromRecording() {
    if (options.catchUp === false || core.status() !== "running") return;
    for (const event of recorded.delivered().taps) {
      const key = tapKey(event);
      if (event.type === "end" || deliveredKeys.has(key)) continue;
      deliveredKeys.add(key);
      core.deliverTap(event);
    }
  }

  function forwardPosition(from: SourceKind, sample: PositionSample) {
    if (from === "live") watchdog.notePosition();
    if (core.status() !== "running" || sources.positions !== from || sample.t < lastPosT) return;
    lastPosT = sample.t;
    core.deliverPosition(sample);
  }

  function finish(t: number) {
    if (core.status() !== "running") return;
    endT = t;
    watchdog.stop();
    core.deliverTap({ type: "end", t });
    core.setStatus("ended");
    live.stop();
    recorded.stop();
  }

  const watchdog = createWatchdog({
    clock,
    link: options.link,
    positionsSilenceS: options.positionsSilenceS,
    linkGraceS: options.linkGraceS,
    watching: () => INPUTS.filter((input) => sources[input] === "live"),
    onDegraded(problem) {
      problems = new Map(problems).set(problem.input, { ...problem, replaced: false });
      if (autoFailover) setSource(problem.input, "replay");
      else announceHealth();
    },
  });

  function setSource(input: InputName, source: SourceKind) {
    if (sources[input] === source) return;
    sources = { ...sources, [input]: source };
    const problem = problems.get(input);
    if (problem !== undefined) {
      problems =
        source === "replay"
          ? new Map(problems).set(input, { ...problem, replaced: true })
          : new Map([...problems].filter(([name]) => name !== input));
    }
    announceHealth();
    if (input === "taps" && source === "replay") catchUpFromRecording();
    // The new taps source may already have ended (e.g. recording shorter than live).
    const tapsFeed = feedFor(sources.taps);
    if (input === "taps" && tapsFeed.status() === "ended") finish(Math.max(lastTapT, tapsFeed.now()));
  }

  const subscriptions: readonly Unsubscribe[] = [
    live.onTap((e) => forwardTap("live", e)),
    recorded.onTap((e) => forwardTap("replay", e)),
    live.onPosition((s) => forwardPosition("live", s)),
    recorded.onPosition((s) => forwardPosition("replay", s)),
    live.onStatus((s) => {
      if (s === "failed" && sources.taps === "live") {
        problems = new Map(problems).set("taps", { input: "taps", reason: live.error() ?? "live feed failed", replaced: false });
        if (autoFailover) setSource("taps", "replay");
        else announceHealth();
      }
    }),
  ];

  return {
    get kind(): FeedKind {
      return sources.taps === "live" || sources.positions === "live" ? "live" : "replay";
    },
    start() {
      if (core.status() !== "idle") return;
      core.setStatus("running");
      watchdog.start();
      live.start();
      recorded.start();
    },
    stop() {
      if (core.status() !== "running") return;
      finish(Math.max(lastTapT, now()));
      subscriptions.forEach((off) => off());
    },
    now,
    status: core.status,
    error: core.error,
    onTap: core.onTap,
    onPosition: core.onPosition,
    onStatus: core.onStatus,
    delivered: core.delivered,
    sources: () => sources,
    setSource,
    health,
    onHealth: healthEvents.add,
  };
}
