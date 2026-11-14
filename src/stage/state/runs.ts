/**
 * Running the kitchen: the first run (step 2) and the second run (step 5),
 * recorded or live. A live run has the recording standing by and switches an
 * input to it when the live one fails, without a restart.
 */
import { batch } from "@preact/signals";
import type { RunBundle, Setup, WorkerDef } from "../../core";
import {
  createLiveFeed,
  createReplayFeed,
  createSwitchableFeed,
  saveRecording,
  type Delivered,
  type InputHealth,
  type RecordingContext,
  type SwitchableRunFeed,
} from "../../inputs";
import type { Kitchen } from "../app/kitchen-edit";
import { runFitsKitchen } from "../app/kitchen-edit";
import { createPlayer, type Player } from "./player";
import { stageLink } from "./link";
import { addNotice, dropNotice, health, params, presence, session, sources, step, type MeasuredRun, type SaveState, type Session } from "./store";

const SAVE_DELAYS_MS: readonly number[] = [0, 1000, 3000];
const FAST_SPEED = 4;
const NO_TABLET_S = 5;

let player: Player | null = null;
let switchable: SwitchableRunFeed | null = null;
let saveState: SaveState = { kind: "none" };
let pendingSave: { readonly delivered: Delivered; readonly context: RecordingContext; readonly feed: SwitchableRunFeed } | null = null;

export function currentPlayer(): Player | null {
  return player;
}

export function liveSwitchable(): SwitchableRunFeed | null {
  return switchable;
}

function publish(s: Omit<Session, "save">): void {
  session.value = { ...s, save: saveState };
}

function setSave(next: SaveState): void {
  saveState = next;
  const s = session.value;
  if (s) session.value = { ...s, save: next };
}

export function stopAllPlayback(): void {
  player?.dispose();
  player = null;
  switchable = null;
  health.value = [];
  session.value = null;
  saveState = { kind: "none" };
}

const allRecorded = () => sources.value.taps === "replay" && sources.value.positions === "replay";

/** True when the next run started now would be live (any of taps or positions live). */
export function nextRunIsLive(): boolean {
  return !allRecorded();
}

function healthNotice(list: readonly InputHealth[]): void {
  const replaced = list.filter((h) => h.state === "replaced");
  if (replaced.length === 0) {
    dropNotice("failover");
    return;
  }
  const why = replaced.map((h) => `${h.input}: ${h.reason ?? "no signal"}`).join("; ");
  addNotice({ id: "failover", text: `Showing the recorded run (${why})`, tone: "calm" });
}

export interface RunPlan {
  readonly purpose: Session["purpose"];
  /** The recording to replay, or to stand by during a live run. */
  readonly recording: RunBundle;
  /** The kitchen on screen, whose setup releases the orders of a live run. */
  readonly kitchen: Kitchen;
  /** Called once, with what was delivered and whether it was live. */
  readonly onEnd: (run: MeasuredRun) => void;
  readonly label: string;
  readonly change?: string;
  readonly baseRunId?: string;
}

function workersOf(...lists: readonly (readonly WorkerDef[])[]): readonly WorkerDef[] {
  const seen = new Map<string, WorkerDef>();
  for (const list of lists) for (const w of list) if (!seen.has(w.id)) seen.set(w.id, w);
  return [...seen.values()];
}

/** Plays the recording at the stage speed. Starts at once. */
function playRecording(plan: RunPlan): void {
  const replay = createReplayFeed(plan.recording, { speed: params.value.speed });
  player = createPlayer({
    feed: replay,
    replay,
    setup: plan.recording.setup,
    workers: plan.recording.layout.workers,
    purpose: plan.purpose,
    visible: () => step.value === (plan.purpose === "first" ? "run" : "test"),
    onSession: publish,
    onEnd: () =>
      plan.onEnd({
        label: plan.recording.meta.id,
        kitchen: { scan: plan.recording.scan, setup: plan.recording.setup, layout: plan.recording.layout },
        taps: plan.recording.taps,
        positions: plan.recording.positions,
        origin: "recorded",
      }),
  });
  player.start();
}

/** Prepares a live run with the recording standing by. Starts on startLive(). */
function prepareLive(plan: RunPlan): void {
  const link = stageLink();
  if (!link) {
    addNotice({ id: "nolink", text: "Not connected to the laptop server, so this run uses the recording.", tone: "calm" });
    playRecording(plan);
    return;
  }
  const setup: Setup = plan.kitchen.setup;
  const live = createLiveFeed({ link, setup, workers: plan.kitchen.layout.workers });
  const fits = runFitsKitchen(plan.recording, plan.kitchen);
  if (!fits) addNotice({ id: "standby", text: "The recording standing by is from another kitchen; if an input fails it will not line up.", tone: "warn" });
  const feed = createSwitchableFeed({
    live,
    recorded: createReplayFeed(plan.recording),
    link,
    sources: { taps: sources.value.taps, positions: sources.value.positions },
  });
  switchable = feed;
  feed.onHealth((list) => {
    health.value = list;
    healthNotice(list);
    // A replaced input stays on the recording for the next run too, until the operator switches it back.
    const replaced = list.filter((h) => h.source === "replay");
    if (replaced.length > 0) sources.value = { ...sources.value, ...Object.fromEntries(replaced.map((h) => [h.input, "replay"])) };
  });
  health.value = feed.health();
  const context: RecordingContext = {
    scan: plan.kitchen.scan,
    setup,
    layout: plan.kitchen.layout,
    title: plan.label,
    ...(plan.change ? { change: plan.change } : {}),
    ...(plan.baseRunId ? { baseRunId: plan.baseRunId } : {}),
  };
  player = createPlayer({
    feed,
    replay: null,
    setup,
    workers: workersOf(plan.kitchen.layout.workers, plan.recording.layout.workers),
    purpose: plan.purpose,
    visible: () => step.value === (plan.purpose === "first" ? "run" : "test"),
    onSession: publish,
    onEnd: (delivered) => {
      live.dispose();
      plan.onEnd({ label: "live run", kitchen: plan.kitchen, taps: delivered.taps, positions: delivered.positions, origin: "live" });
      pendingSave = { delivered, context, feed };
      void save();
    },
  });
  publish({ purpose: plan.purpose, status: "idle", t: 0, duration: null, done: 0, total: setup.schedule.orders.length, speed: 1, replay: false });
}

/** Starts a run per the current sources: a recording plays at once; a live run waits for startLive(). */
export function beginRun(plan: RunPlan): void {
  stopAllPlayback();
  dropNotice("failover");
  if (allRecorded()) playRecording(plan);
  else prepareLive(plan);
}

/** "Start run" for a prepared live run. */
export function startLive(): void {
  if (!player || player.feed.status() !== "idle") return;
  player.start();
  watchTablets();
}

/**
 * The input layer never judges taps by silence (a slow station is quiet too).
 * But with no tablet connected at all for NO_TABLET_S, nobody can tap: the
 * recorded taps take over, said calmly on screen.
 */
function watchTablets(): void {
  const feed = switchable;
  if (!feed) return;
  let since: number | null = null;
  const timer = setInterval(() => {
    if (switchable !== feed || feed.status() !== "running") return clearInterval(timer);
    if (feed.sources().taps !== "live") return;
    if (presence.value.tablet > 0) {
      since = null;
      return;
    }
    since ??= performance.now();
    if (performance.now() - since >= NO_TABLET_S * 1000) {
      feed.setSource("taps", "replay");
      sources.value = { ...sources.value, taps: "replay" };
      addNotice({ id: "notablet", text: `Showing the recorded taps (no tablet connected for ${NO_TABLET_S} s)`, tone: "calm" });
    }
  }, 500);
}

export function toggleFaster(): void {
  const r = player?.replay;
  if (!r || r.status() === "ended") return;
  const slow = params.value.speed >= FAST_SPEED ? 1 : params.value.speed;
  const fast = Math.max(FAST_SPEED, params.value.speed);
  r.setSpeed(r.speed() >= fast ? slow : fast);
  player?.redraw();
}

export function skipToEnd(): void {
  const p = player;
  if (!p) return;
  if (p.replay) p.finish();
  else if (p.feed.status() === "running") p.finish();
}

async function save(): Promise<void> {
  const job = pendingSave;
  if (!job) return;
  for (let i = 0; i < SAVE_DELAYS_MS.length; i += 1) {
    await new Promise((r) => setTimeout(r, SAVE_DELAYS_MS[i]));
    setSave({ kind: "saving", attempt: i + 1 });
    try {
      const receipt = await saveRecording(job.feed, job.context);
      batch(() => {
        setSave({ kind: "saved", where: `recordings/${receipt.id}/` });
        dropNotice("save");
      });
      pendingSave = null;
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (i === SAVE_DELAYS_MS.length - 1) {
        setSave({ kind: "failed", error: message });
        addNotice({ id: "save", text: "The run is kept on screen but could not be saved. Press S to try again.", tone: "warn" });
      }
    }
  }
}

export function retrySave(): void {
  if (pendingSave && saveState.kind === "failed") void save();
}
