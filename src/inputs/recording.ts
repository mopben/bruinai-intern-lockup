/**
 * Saving a live run as a run folder, in exactly the fixture format.
 */
import { FORMAT_VERSION, RUN_FORMAT } from "../core/types";
import type { Layout, RunBundle, RunMeta, Scan, Setup } from "../core/types";
import { postRecording, type RecordingReceipt } from "./api";
import type { RunFeed } from "./feed";
import type { InputHealth } from "./switchable-feed";

/** Feeds that can say where each input came from (a SwitchableRunFeed) are labelled honestly. */
type RecordableFeed = Pick<RunFeed, "delivered" | "now"> & { readonly health?: () => readonly InputHealth[] };

/** " (positions partly from the recording)" when any input was not live for the whole run. */
export function replayedNote(feed: RecordableFeed): string {
  const replayed = (feed.health?.() ?? []).filter((h) => h.source === "replay" || h.state !== "ok").map((h) => h.input);
  return replayed.length === 0 ? "" : ` (${replayed.join(" and ")} partly from the recording)`;
}

export interface RecordingContext {
  readonly scan: Scan;
  readonly setup: Setup;
  readonly layout: Layout;
  readonly title: string;
  readonly change?: string;
  readonly baseRunId?: string;
  /** Default: rec-<date>-<time>. Sanitised again by the server. */
  readonly id?: string;
  readonly recordedAt?: Date;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function recordingId(at: Date): string {
  return `rec-${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
}

/** Builds a bundle from what a feed has delivered so far. Adds a closing "end" if the run has not ended. */
export function bundleFromFeed(feed: RecordableFeed, context: RecordingContext): RunBundle {
  const at = context.recordedAt ?? new Date();
  const { taps, positions } = feed.delivered();
  const ended = taps[taps.length - 1]?.type === "end";
  const lastT = Math.max(feed.now(), ...taps.map((e) => e.t), ...positions.map((p) => p.t));
  const meta: RunMeta = {
    format: RUN_FORMAT,
    version: FORMAT_VERSION,
    id: context.id ?? recordingId(at),
    title: `${context.title}${replayedNote(feed)}`,
    ...(context.change === undefined ? {} : { change: context.change }),
    ...(context.baseRunId === undefined ? {} : { baseRunId: context.baseRunId }),
    recordedAt: at.toISOString(),
    source: "recorded",
  };
  return {
    meta,
    scan: context.scan,
    setup: context.setup,
    layout: context.layout,
    taps: ended ? taps : [...taps, { type: "end", t: lastT }],
    positions,
  };
}

/** Sends the run to the laptop server, which writes recordings/<id>/. */
export function saveRecording(
  feed: RecordableFeed,
  context: RecordingContext,
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>,
): Promise<RecordingReceipt> {
  return postRecording(bundleFromFeed(feed, context), fetchImpl);
}
