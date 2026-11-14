/**
 * Live: the stage is the run clock.
 *
 * - Releases the setup's scheduled orders at their times and broadcasts them,
 *   so the tablets show them.
 * - Stamps each `tap` from a tablet with stage run time on receipt, delivers it
 *   as a DoneEvent and broadcasts the stamped event (which is also the tablet's ack).
 * - Stamps each camera position report on receipt.
 * - Answers `sync-request` with the full run state, so a tablet that joins late
 *   or reconnects rebuilds its view.
 */
import type { DoneEvent, OrderEvent, Setup, TapEvent, WorkerDef } from "../core/types";
import { realClock, type Clock, type TimerId } from "./clock";
import { createFeedCore, type RunFeed } from "./feed";
import {
  controlMessageSchema,
  positionReportSchema,
  tapRequestSchema,
  type RunStateMessage,
  type RunStatusOnWire,
  type StampedDone,
  type TapRejected,
  type TapRequest,
} from "./protocol";
import type { LinkState, MessageLink, Unsubscribe } from "./socket";

export interface LiveFeedOptions {
  readonly link: MessageLink;
  readonly setup: Setup;
  readonly workers: readonly WorkerDef[];
  /** Shown to tablets; also the default id of a saved recording. */
  readonly runId?: string;
  readonly clock?: Clock;
  /** End by itself once every scheduled order is through its last step. Default true. */
  readonly autoEnd?: boolean;
}

export interface LiveRunFeed extends RunFeed {
  readonly kind: "live";
  readonly runId: string;
  linkState(): LinkState;
  /** Releases on the tablet are timed from start(); this is the setup they come from. */
  readonly setup: Setup;
  /** Detaches from the link entirely (stops answering sync-requests). */
  dispose(): void;
}

const round3 = (t: number) => Math.round(t * 1000) / 1000;

export function createLiveFeed(options: LiveFeedOptions): LiveRunFeed {
  const { link, setup, workers } = options;
  const clock = options.clock ?? realClock;
  const runId = options.runId ?? `live-${Date.now().toString(36)}`;
  const autoEnd = options.autoEnd ?? true;
  const core = createFeedCore();
  const itemsById = new Map(setup.menu.map((m) => [m.id, m]));
  const scheduled = [...setup.schedule.orders].sort((a, b) => a.t - b.t);

  let startWall = 0;
  let endT = 0;
  let releaseTimer: TimerId | undefined;
  let nextRelease = 0;
  const released = new Map<string, OrderEvent>();
  const doneSteps = new Set<string>();
  const acceptedTapIds = new Map<string, StampedDone>();

  const now = (): number => {
    if (core.status() === "running") return round3((clock.now() - startWall) / 1000);
    return core.status() === "idle" ? 0 : endT;
  };

  const wireStatus = (): RunStatusOnWire =>
    core.status() === "running" ? "running" : core.status() === "idle" ? "idle" : "ended";

  const runState = (): RunStateMessage => ({
    type: "run-state",
    runId,
    status: wireStatus(),
    t: now(),
    setup,
    workers,
    events: core.delivered().taps,
  });

  const broadcastTap = (message: TapEvent | StampedDone | TapRejected) => link.send("taps", message);

  const deliverAndBroadcast = (event: TapEvent, wire: TapEvent | StampedDone = event) => {
    core.deliverTap(event);
    broadcastTap(wire);
  };

  function releaseDue() {
    releaseTimer = undefined;
    if (core.status() !== "running") return;
    const t = now();
    for (let o = scheduled[nextRelease]; o !== undefined && o.t <= t; o = scheduled[nextRelease]) {
      nextRelease += 1;
      const event: OrderEvent = { type: "order", t: round3(Math.max(o.t, 0)), orderId: o.orderId, itemId: o.itemId };
      released.set(o.orderId, event);
      deliverAndBroadcast(event);
    }
    const upcoming = scheduled[nextRelease];
    if (upcoming !== undefined) releaseTimer = clock.setTimeout(releaseDue, Math.max(0, (upcoming.t - now()) * 1000));
  }

  const allDone = (): boolean =>
    scheduled.length > 0 &&
    scheduled.every((o) => {
      const item = itemsById.get(o.itemId);
      return item !== undefined && doneSteps.has(`${o.orderId}#${item.steps.length - 1}`);
    });

  const reject = (tapId: string, reason: string) => broadcastTap({ type: "tap-rejected", tapId, reason });

  function checkTap(tap: TapRequest): string | undefined {
    if (core.status() !== "running") return "the run is not running";
    const order = released.get(tap.orderId);
    if (order === undefined) return `order ${tap.orderId} is not on the board`;
    const item = itemsById.get(order.itemId);
    if (item === undefined || tap.step >= item.steps.length) return `order ${tap.orderId} has no step ${tap.step}`;
    if (doneSteps.has(`${tap.orderId}#${tap.step}`)) return `order ${tap.orderId} step ${tap.step} is already done`;
    if (tap.step > 0 && !doneSteps.has(`${tap.orderId}#${tap.step - 1}`)) {
      return `order ${tap.orderId}: step ${tap.step - 1} is not done yet`;
    }
    return undefined;
  }

  function onTapRequest(payload: unknown) {
    const parsed = tapRequestSchema.safeParse(payload);
    if (!parsed.success) return; // stage broadcasts and other tablets' traffic land here too
    const tap = parsed.data;
    const previous = acceptedTapIds.get(tap.tapId);
    if (previous !== undefined) return void broadcastTap(previous); // resend: ack again, deliver nothing
    const problem = checkTap(tap);
    if (problem !== undefined) return reject(tap.tapId, problem);

    const order = released.get(tap.orderId) as OrderEvent;
    const step = itemsById.get(order.itemId)?.steps[tap.step];
    const done: DoneEvent = {
      type: "done",
      t: now(),
      orderId: tap.orderId,
      step: tap.step,
      stationId: step?.stationId ?? tap.stationId,
      ...(tap.workerId === undefined ? {} : { workerId: tap.workerId }),
    };
    doneSteps.add(`${tap.orderId}#${tap.step}`);
    const stamped: StampedDone = { ...done, tapId: tap.tapId };
    acceptedTapIds.set(tap.tapId, stamped);
    deliverAndBroadcast(done, stamped);
    if (autoEnd && allDone()) stop();
  }

  function onPositions(payload: unknown) {
    if (core.status() !== "running") return;
    const parsed = positionReportSchema.safeParse(payload);
    if (!parsed.success) return;
    const t = now();
    for (const s of parsed.data.samples) core.deliverPosition({ type: "pos", t, workerId: s.workerId, x: s.x, z: s.z });
  }

  function onControl(payload: unknown) {
    const parsed = controlMessageSchema.safeParse(payload);
    if (parsed.success && parsed.data.type === "sync-request") link.send("control", runState());
  }

  function stop() {
    if (core.status() !== "running") return;
    endT = now();
    if (releaseTimer !== undefined) clock.clearTimeout(releaseTimer);
    releaseTimer = undefined;
    core.deliverTap({ type: "end", t: endT });
    core.setStatus("ended");
    broadcastTap({ type: "end", t: endT });
    link.send("control", runState());
    offInputs.forEach((off) => off());
  }

  const offInputs: readonly Unsubscribe[] = [
    link.subscribe("taps", onTapRequest),
    link.subscribe("positions", onPositions),
  ];
  // Control stays subscribed after the end, so late tablets still learn "run over".
  const offControl = link.subscribe("control", onControl);
  // Tell tablets what is coming as soon as the feed exists.
  link.send("control", runState());
  const offState = link.onState((s) => {
    if (s === "open") link.send("control", runState());
  });

  return {
    kind: "live",
    runId,
    setup,
    start() {
      if (core.status() !== "idle") return;
      startWall = clock.now();
      core.setStatus("running");
      link.send("control", runState());
      releaseDue();
    },
    stop,
    now,
    status: core.status,
    error: core.error,
    onTap: core.onTap,
    onPosition: core.onPosition,
    onStatus: core.onStatus,
    delivered: core.delivered,
    linkState: () => link.state(),
    dispose() {
      offInputs.forEach((off) => off());
      offControl();
      offState();
      if (releaseTimer !== undefined) clock.clearTimeout(releaseTimer);
      releaseTimer = undefined;
    },
  };
}
