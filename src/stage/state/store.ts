/**
 * The stage's state, as signals. Values are immutable; every change replaces
 * a value. Controllers in this folder change them; components only read them
 * and call controller actions.
 */
import { computed, signal } from "@preact/signals";
import type { Layout, PositionSample, RunBundle, Scan, TapEvent } from "../../core";
import type { InputHealth, LinkState, RoleCounts, RunListing, ServerInfo } from "../../inputs";
import { NO_CLIENTS } from "../../inputs";
import type { Kitchen } from "../app/kitchen-edit";
import type { Candidate } from "../app/layout-match";
import type { FrozenPrediction } from "../app/frozen";
import type { StageParams } from "../app/params";
import { stepOf, type ViewId } from "../app/steps";
import type { TestOutcome } from "../app/words";

export type Source = "live" | "replay";
export type InputKind = "scan" | "taps" | "positions";
export type Sources = Readonly<Record<InputKind, Source>>;

/** A measured run: what the model learns from (first run) or is checked against (second run). */
export interface MeasuredRun {
  /** Run id or "live" label, shown as the basis of the numbers. */
  readonly label: string;
  readonly kitchen: Kitchen;
  readonly taps: readonly TapEvent[];
  readonly positions: readonly PositionSample[];
  readonly origin: "recorded" | "live";
  /** The run's title for people ("Original counter"), when it has one. */
  readonly title?: string;
  /** Inputs that came partly or wholly from a recording during a live run (empty when all live, or for a recording). */
  readonly replaced: readonly string[];
  /** The id it was saved under (recordings/<id>/), once saved. */
  readonly savedId?: string;
}

export type SaveState =
  | { readonly kind: "none" }
  | { readonly kind: "saving"; readonly attempt: number }
  | { readonly kind: "saved"; readonly where: string }
  | { readonly kind: "failed"; readonly error: string };

/** What the run controls show, updated about ten times a second. */
export interface Session {
  readonly purpose: "first" | "second";
  readonly status: "idle" | "running" | "ended";
  readonly t: number;
  readonly duration: number | null;
  readonly done: number;
  readonly total: number;
  readonly speed: number;
  /** True when this playback is a recording (speed and skip available). */
  readonly replay: boolean;
  readonly save: SaveState;
}

export interface Notice {
  readonly id: string;
  readonly text: string;
  readonly tone: "calm" | "warn";
}

export type ScanState = "waiting" | "revealing" | "ready";

/** The Test step's chosen second run and the frozen entry it is compared with. */
export interface TestPlan {
  /** The recorded second run: played (recorded mode) or standing by (live mode). */
  readonly candidate: Candidate | null;
  /** True when the run compared is the judge's own change (a matching recording, or live). */
  readonly matched: boolean;
  readonly live: boolean;
  /** The layout actually run and compared: the judge's when matched, else the recorded run's. */
  readonly layout: Layout;
  /** The judge's layout (from Play) this plan was made for; a different Play layout makes the plan stale. */
  readonly judgeLayout: Layout;
  readonly bundle: RunBundle | null;
  readonly loadError: string | null;
}

export const params = signal<StageParams>({ runId: "counter-a", mode: "replay", speed: 1, view: "play" });
export const bootError = signal<string | null>(null);
export const loading = signal(true);

export const catalog = signal<readonly RunListing[]>([]);
export const candidates = signal<readonly Candidate[]>([]);
export const base = signal<RunBundle | null>(null);
export const serverInfo = signal<ServerInfo | null>(null);
export const presence = signal<RoleCounts>(NO_CLIENTS);
export const linkState = signal<LinkState>("connecting");

export const sources = signal<Sources>({ scan: "replay", taps: "replay", positions: "replay" });
export const health = signal<readonly InputHealth[]>([]);
export const notices = signal<readonly Notice[]>([]);
export const panel = signal<{ open: boolean; width: number }>({ open: true, width: 420 });
/** "auto" picks the recorded run matching the judge's change. */
export const secondChoice = signal<string>("auto");

export const view = signal<ViewId>("play");
export const currentStep = computed(() => stepOf(view.value));
export const orderCount = signal<number | null>(null);
export const kitchen = signal<Kitchen | null>(null);
export const kitchenOrigin = signal<"recorded" | "live">("recorded");
export const latestLiveScan = signal<Scan | null>(null);
export const importOpen = signal(false);
export const scanState = signal<ScanState>("waiting");
export const scanNotes = signal<readonly string[]>([]);
export const selectedId = signal<string | null>(null);
/** Dragging in the Scan step: on for a live scan or after adding a floor mark. */
export const moveInScan = signal(false);

export const firstRun = signal<MeasuredRun | null>(null);
export const session = signal<Session | null>(null);
export const storyText = signal<string | null>(null);

export const playLayout = signal<Layout | null>(null);
export const frozen = signal<FrozenPrediction | null>(null);
export const testPlan = signal<TestPlan | null>(null);
export const secondRun = signal<MeasuredRun | null>(null);
export const outcome = signal<TestOutcome | null>(null);
/** Set when the second run finished no orders, or the frozen entry has no prediction. */
export const outcomeProblem = signal<string | null>(null);

export function addNotice(n: Notice): void {
  notices.value = [...notices.value.filter((x) => x.id !== n.id), n];
}

export function dropNotice(id: string): void {
  if (notices.value.some((n) => n.id === id)) notices.value = notices.value.filter((n) => n.id !== id);
}

/** Commands for the Compare step's own clock (it plays simulated runs, not a feed). */
export const compareCommand = signal<{ readonly kind: "replay" | "faster" | "skip"; readonly n: number } | null>(null);
export function sendCompare(kind: "replay" | "faster" | "skip"): void {
  compareCommand.value = { kind, n: (compareCommand.value?.n ?? 0) + 1 };
}
