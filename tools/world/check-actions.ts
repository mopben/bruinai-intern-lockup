/**
 * actions.jsonl (optional): known workers, boxes with the right role, segments
 * that end after they start and do not overlap for one worker, time order, and
 * labels that come with a confidence.
 */
import { ACTION_BOX_ROLES, type ActionSegment, type BoxedAction, type Layout, type Scan, type Setup } from "../../src/core/types";
import { boxLabel, type Lined, type Sink } from "./checks";

const F = "actions.jsonl";

export interface ActionsContext {
  readonly scan?: Scan;
  readonly setup?: Setup;
  readonly layout?: Layout;
  /** When the run ended (the taps' "end", or the last tap). */
  readonly runEnd?: number;
}

type Seg = Lined<ActionSegment>;

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

function checkTimeOrder(segments: readonly Seg[], s: Sink): void {
  segments.forEach((seg, i) => {
    const prev = segments[i - 1];
    if (prev && seg.value.t0 < prev.value.t0) {
      s.warn(F, `t0=${seg.value.t0} is earlier than the line above (t0=${prev.value.t0}). Lines are read in time order anyway, but keep the file sorted by t0.`, seg.line);
    }
  });
}

function checkWorkers(segments: readonly Seg[], layout: Layout, s: Sink): void {
  const known = layout.workers.map((w) => w.id);
  const strangers = segments.filter((seg) => !known.includes(seg.value.workerId));
  const firstOfEach = strangers.filter((seg, i) => strangers.findIndex((o) => o.value.workerId === seg.value.workerId) === i);
  firstOfEach.forEach((seg) => {
    s.error(F, `worker "${seg.value.workerId}" is not in layout.json "workers". Use the same ids in all files (known: ${known.join(", ") || "none"}).`, seg.line);
  });
}

const hasBox = (seg: Seg): seg is Lined<BoxedAction> => "boxId" in seg.value;

function checkBoxes(segments: readonly Seg[], scan: Scan, setup: Setup | undefined, s: Sink): void {
  const inScan = new Set(scan.boxes.map((b) => b.id));
  const roleOf = (id: string) => setup?.items.find((i) => i.boxId === id)?.role;
  segments.filter(hasBox).forEach((seg) => {
    const { kind, boxId } = seg.value;
    if (!inScan.has(boxId)) {
      s.error(F, `"${kind}" names box "${boxId}", which is not in scan.json. Copy the id from scan.json.`, seg.line);
      return;
    }
    if (!setup) return;
    const role = roleOf(boxId);
    const wanted = ACTION_BOX_ROLES[kind];
    if (role === undefined || !wanted.includes(role)) {
      const must = wanted.map((r) => `"${r}"`).join(" or ");
      s.error(F, `"${kind}" names ${boxLabel(boxId, setup)}, whose role is "${role ?? "none"}"; it must be ${must}.`, seg.line);
    }
  });
}

interface Overlap {
  readonly seg: Seg;
  readonly prev: Seg;
}

/** Overlaps within one worker's segments, sorted by t0. Touching (t0 equal to the previous t1) is fine. */
function overlapsIn(track: readonly Seg[]): readonly Overlap[] {
  const start: { readonly latest?: Seg; readonly found: readonly Overlap[] } = { found: [] };
  return track.reduce((acc, seg) => {
    const { latest } = acc;
    const found = latest && seg.value.t0 < latest.value.t1 ? [...acc.found, { seg, prev: latest }] : acc.found;
    return { latest: !latest || seg.value.t1 > latest.value.t1 ? seg : latest, found };
  }, start).found;
}

function checkSpans(segments: readonly Seg[], s: Sink): void {
  segments.filter((seg) => seg.value.t1 <= seg.value.t0).forEach((seg) => {
    s.error(F, `t1=${seg.value.t1} is not later than t0=${seg.value.t0}. A segment must end after it starts.`, seg.line);
  });
  const valid = [...segments.filter((seg) => seg.value.t1 > seg.value.t0)].sort((a, b) => a.value.t0 - b.value.t0 || a.line - b.line);
  const workers = [...new Set(valid.map((seg) => seg.value.workerId))];
  const overlaps = workers.flatMap((w) => overlapsIn(valid.filter((seg) => seg.value.workerId === w)));
  [...overlaps].sort((a, b) => a.seg.line - b.seg.line).forEach(({ seg, prev }) => {
    s.error(
      F,
      `worker "${seg.value.workerId}" does two things at once: this segment (t0=${seg.value.t0} to t1=${seg.value.t1}) starts before the one on line ${prev.line} ends (t1=${prev.value.t1}). One worker's segments must not overlap; fix t0 or t1.`,
      seg.line,
    );
  });
}

function checkRunEnd(segments: readonly Seg[], runEnd: number, s: Sink): void {
  const late = segments.filter((seg) => seg.value.t1 > runEnd);
  const first = late[0];
  if (!first) return;
  const what = plural(late.length, "segment ends", "segments end");
  s.warn(F, `${what} after the run ended (t=${runEnd}; first here: t1=${first.value.t1}). Check the video's clock against the taps.`, first.line);
}

function checkLabels(segments: readonly Seg[], s: Sink): void {
  segments.forEach(({ value, line }) => {
    const hasLabel = value.label !== undefined;
    const hasConfidence = value.confidence !== undefined;
    if (hasLabel && !hasConfidence) s.warn(F, 'has "label" but no "confidence". The labeller writes both; add the confidence or remove the label.', line);
    if (hasConfidence && !hasLabel) s.warn(F, 'has "confidence" but no "label". The labeller writes both; add the label or remove the confidence.', line);
  });
}

export function checkActions(segments: readonly Seg[], ctx: ActionsContext, s: Sink): { segments: number } {
  checkTimeOrder(segments, s);
  if (ctx.layout) checkWorkers(segments, ctx.layout, s);
  if (ctx.scan) checkBoxes(segments, ctx.scan, ctx.setup, s);
  checkSpans(segments, s);
  if (ctx.runEnd !== undefined) checkRunEnd(segments, ctx.runEnd, s);
  checkLabels(segments, s);
  return { segments: segments.length };
}
