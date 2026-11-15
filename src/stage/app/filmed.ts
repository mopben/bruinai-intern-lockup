/**
 * The Filmed run view's pure parts: what a worker is doing at a time (from
 * actions.jsonl), the hand-labelling caption (from run.json), and which
 * recorded run a dropped video file belongs to. No DOM.
 */
import type { ActionSegment, RunMeta } from "../../core";

export const FILMED_VIDEO_FILE = "video.mp4";
export const VIDEO_INFO_FILE = "video.json";
const VIDEO_EXTENSIONS: readonly string[] = [".mov", ".mp4", ".m4v", ".webm"];
const MIN_STEM_LENGTH = 4;

/** True for a dropped file that is a video by type or by name. */
export function isVideoFile(name: string, type: string): boolean {
  const lower = name.toLowerCase();
  return type.startsWith("video/") || VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * What the worker is doing at t: their segment with t0 <= t < t1. Null before their first segment and
 * in a gap between two; their last segment holds to the end of the run (the log stops just short of it).
 */
export function actionAt(segments: readonly ActionSegment[], workerId: string, t: number): ActionSegment | null {
  const mine = segments.filter((s) => s.workerId === workerId);
  const last = mine.reduce<ActionSegment | null>((latest, s) => (latest === null || s.t0 >= latest.t0 ? s : latest), null);
  return mine.find((s) => s.t0 <= t && t < s.t1) ?? (last && t >= last.t1 ? last : null);
}

/** "work - pouring a drink", "carry to Chips station", "walk". */
export function actionWords(action: ActionSegment | null, boxName: (boxId: string) => string): string {
  if (!action) return "not seen";
  const where = "boxId" in action ? boxName(action.boxId) : null;
  const place = where === null ? "" : action.kind === "work" ? ` at ${where}` : action.kind === "fetch" ? ` from ${where}` : ` to ${where}`;
  return `${action.kind}${place}${action.label ? ` - ${action.label}` : ""}`;
}

/** The sentences of run.json that say what was labelled or made by hand; the title when none does. */
export function handLabelNote(meta: Pick<RunMeta, "title" | "change">): string {
  const sentences = (meta.change ?? "").split(/(?<=[.!?])\s+/).filter((s) => /hand|label/i.test(s));
  return sentences.length > 0 ? sentences.join(" ") : meta.title;
}

/** A recorded run that has a processed video beside it. */
export interface VideoRun {
  readonly id: string;
  readonly title: string;
  readonly change?: string;
  readonly recordedAt: string;
  /** File names of the videos it was made from (video.json), if the folder says. */
  readonly sourceFiles: readonly string[];
}

function names(run: VideoRun, file: string): boolean {
  const lower = file.toLowerCase();
  const stem = lower.replace(/\.[a-z0-9]+$/, "");
  if (run.sourceFiles.some((f) => f.toLowerCase() === lower)) return true;
  const text = `${run.title} ${run.change ?? ""}`.toLowerCase();
  return text.includes(lower) || (stem.length >= MIN_STEM_LENGTH && text.includes(stem));
}

/** The run that names the dropped file; else the newest run with a video; null when there is none. */
export function matchVideoRun(fileName: string, runs: readonly VideoRun[]): VideoRun | null {
  const newestFirst = [...runs].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  return newestFirst.find((run) => names(run, fileName)) ?? newestFirst[0] ?? null;
}
