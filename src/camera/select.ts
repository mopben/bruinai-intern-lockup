/**
 * Picks this frame's hat from the candidate blobs of one colour.
 *
 * One clear blob: take it. Two similar-sized blobs far apart (another hat of
 * the same colour, a red mug, a poster): ambiguous. Then, if we know where
 * the hat was a moment ago, take the candidate close to it; otherwise report
 * nothing rather than guess.
 */
import type { Blob } from "./blobs";
import type { Pt } from "./homography";

export type Pick =
  | { readonly kind: "found"; readonly blob: Blob }
  | { readonly kind: "ambiguous" }
  | { readonly kind: "none" };

export interface SelectOptions {
  /** A rival at least this fraction of the largest area makes it ambiguous. */
  readonly rivalRatio: number;
  /** Max jump from the previous position, as a multiple of the frame width. */
  readonly gateFraction: number;
}

export const DEFAULT_SELECT: SelectOptions = { rivalRatio: 0.45, gateFraction: 0.08 };

export function chooseBlob(blobs: readonly Blob[], frameWidth: number, prev: Pt | undefined, o: SelectOptions = DEFAULT_SELECT): Pick {
  const [first, second] = blobs;
  if (!first) return { kind: "none" };
  const gate = o.gateFraction * frameWidth;
  const dist = (b: Blob) => (prev ? Math.hypot(b.cx - prev.x, b.cy - prev.y) : Number.POSITIVE_INFINITY);
  const contested = second !== undefined && second.area >= o.rivalRatio * first.area;
  if (!contested) return { kind: "found", blob: first };
  if (!prev) return { kind: "ambiguous" };
  const rivals = blobs.filter((b) => b.area >= o.rivalRatio * first.area);
  const near = rivals.filter((b) => dist(b) <= gate).sort((a, b) => dist(a) - dist(b));
  return near.length === 1 ? { kind: "found", blob: near[0]! } : { kind: "ambiguous" };
}
