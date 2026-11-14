/**
 * Plays a run feed onto the main scene: pawns from the position log, tickets
 * from the taps. The same code for a recording and a live run; it never asks
 * which one it has.
 */
import { reconstructRun, queueAt, type Setup, type WorkerDef } from "../../core";
import type { Delivered, ReplayRunFeed, RunFeed } from "../../inputs";
import { latestPositions } from "../app/playback";
import { mainScene } from "./scene-ref";
import type { Session } from "./store";

const SESSION_EVERY_MS = 100;

export interface PlayerOptions {
  readonly feed: RunFeed;
  /** Present when the feed is a plain recording: speed and skip work. */
  readonly replay: ReplayRunFeed | null;
  readonly setup: Setup;
  /** Workers whose ids may appear in the position log (live and recorded). */
  readonly workers: readonly WorkerDef[];
  readonly purpose: Session["purpose"];
  /** Draw to the scene only while this is true (the operator may look at another step). */
  readonly visible: () => boolean;
  readonly onSession: (s: Omit<Session, "save">) => void;
  readonly onEnd: (delivered: Delivered) => void;
}

export interface Player {
  readonly feed: RunFeed;
  readonly replay: ReplayRunFeed | null;
  start(): void;
  /** Ends the run now (a recording jumps to its end). */
  finish(): void;
  dispose(): void;
  /** Push the current frame again, e.g. after coming back to the step. */
  redraw(): void;
}

export function createPlayer(o: PlayerOptions): Player {
  let raf = 0;
  let lastSession = 0;
  let ended = false;
  let disposed = false;
  let tapCount = -1;
  let run = reconstructRun(o.setup, []);
  const total = o.setup.schedule.orders.length;

  const session = (): Omit<Session, "save"> => {
    const status = o.feed.status();
    return {
      purpose: o.purpose,
      status: status === "idle" ? "idle" : status === "running" ? "running" : "ended",
      t: o.feed.now(),
      duration: o.replay ? o.replay.duration() : null,
      done: run.orders.filter((x) => x.completed).length,
      total,
      speed: o.replay ? o.replay.speed() : 1,
      replay: o.replay !== null,
    };
  };

  function draw(force: boolean): void {
    const d = o.feed.delivered();
    if (d.taps.length !== tapCount) {
      tapCount = d.taps.length;
      run = reconstructRun(o.setup, d.taps);
    }
    const scene = mainScene();
    if (scene && o.visible()) {
      scene.setWorkers(latestPositions(d.positions, o.workers));
      scene.setQueues(queueAt(run.queue, o.feed.now()));
    }
    const now = performance.now();
    if (force || now - lastSession >= SESSION_EVERY_MS) {
      lastSession = now;
      o.onSession(session());
    }
  }

  function frame(): void {
    if (disposed) return;
    draw(false);
    const status = o.feed.status();
    if ((status === "ended" || status === "failed") && !ended) {
      ended = true;
      draw(true);
      o.onEnd(o.feed.delivered());
      return;
    }
    raf = requestAnimationFrame(frame);
  }

  return {
    feed: o.feed,
    replay: o.replay,
    start() {
      if (disposed) return;
      o.feed.start();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
      draw(true);
    },
    finish() {
      if (o.replay) o.replay.skipToEnd();
      else o.feed.stop();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      if (o.feed.status() === "running" && o.replay) o.feed.stop();
    },
    redraw: () => draw(true),
  };
}
