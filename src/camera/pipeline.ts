/**
 * One frame in, floor positions out. Pure apart from the pixel buffers.
 *
 * frame (working size) -> HSV -> per worker: colour mask -> blobs -> pick
 * -> centroid in source pixels -> floor point under the hat (at that worker's
 * hat height) -> reject if outside the room -> smoothing and gap rules.
 */
import type { Vec2 } from "../core/types";
import type { Blob } from "./blobs";
import { detectColour } from "./blobs";
import { imageToFloorAt, type CameraModel } from "./camera-model";
import { DEFAULT_THRESHOLDS, type Hsv, type Thresholds } from "./color";
import { toHsvPlanes, type Frame, type HsvPlanes } from "./frame";
import type { Pt } from "./homography";
import { insideBounds, type Bounds } from "./kitchen";
import { chooseBlob, DEFAULT_SELECT, type Pick } from "./select";
import { DEFAULT_TRACKER, LOST, recorded, reported, stepTrack, type TrackerOptions, type WorkerTrack } from "./tracker";

/** Assumed height of the middle of a hat above the floor, metres, until measured. */
export const DEFAULT_HAT_HEIGHT_M = 1.65;
/** Smallest hat blob, as a fraction of the working frame's pixels (78 px at 480x270; a hat 4 m away is about 270). */
export const MIN_AREA_FRACTION = 0.0006;
/** Floor points this far outside the room are rejected as false detections. */
export const BOUNDS_MARGIN_M = 0.5;

export interface WorkerSpec {
  readonly id: string;
  readonly target: Hsv;
  readonly hatHeightM: number;
}

export interface PipelineConfig {
  readonly workers: readonly WorkerSpec[];
  readonly model?: CameraModel;
  /** Size of the original picture; calibration clicks are in these pixels. */
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly bounds?: Bounds;
  readonly thresholds?: Thresholds;
  readonly tracker?: TrackerOptions;
}

export interface PipelineState {
  readonly tracks: ReadonlyMap<string, WorkerTrack>;
  /** Last picked blob centre per worker, working pixels (for ambiguity). */
  readonly prevPx: ReadonlyMap<string, Pt>;
}

export const EMPTY_STATE: PipelineState = { tracks: new Map(), prevPx: new Map() };

export interface WorkerResult {
  readonly id: string;
  readonly pick: Pick["kind"];
  readonly blob?: Blob;
  /** Hat centre in source pixels. */
  readonly imagePx?: Pt;
  /** Raw floor point under the hat this frame (before smoothing). */
  readonly raw?: Vec2;
  /** Why a found hat was not used, if it was not. */
  readonly rejected?: "outside-room" | "no-calibration";
  readonly track: WorkerTrack;
  readonly mask: Uint8Array;
  readonly candidates: number;
}

export interface FrameResult {
  readonly state: PipelineState;
  readonly workers: readonly WorkerResult[];
  readonly planes: HsvPlanes;
  /** What to send live: tracked workers (locked, or held for a moment). */
  readonly samples: readonly FloorSample[];
  /** What to write to a file: fresh sightings only (a gap beats a stale point). */
  readonly fresh: readonly FloorSample[];
}

export interface FloorSample {
  readonly workerId: string;
  readonly x: number;
  readonly z: number;
}

export function processFrame(frame: Frame, t: number, state: PipelineState, cfg: PipelineConfig): FrameResult {
  const planes = toHsvPlanes(frame);
  const th = cfg.thresholds ?? DEFAULT_THRESHOLDS;
  const minArea = Math.max(6, MIN_AREA_FRACTION * frame.width * frame.height);
  const kx = cfg.sourceWidth / frame.width;
  const ky = cfg.sourceHeight / frame.height;
  const tracks = new Map(state.tracks);
  const prevPx = new Map(state.prevPx);
  const workers = cfg.workers.map((w): WorkerResult => {
    const det = detectColour(planes, w.target, th, minArea);
    const pick = chooseBlob(det.blobs, frame.width, state.prevPx.get(w.id), DEFAULT_SELECT);
    let raw: Vec2 | undefined;
    let rejected: WorkerResult["rejected"];
    let imagePx: Pt | undefined;
    if (pick.kind === "found") {
      prevPx.set(w.id, { x: pick.blob.cx, y: pick.blob.cy });
      imagePx = { x: pick.blob.cx * kx, y: pick.blob.cy * ky };
      if (!cfg.model) rejected = "no-calibration";
      else {
        const g = imageToFloorAt(cfg.model, imagePx, w.hatHeightM);
        if (g && (!cfg.bounds || insideBounds(cfg.bounds, g, BOUNDS_MARGIN_M))) raw = g;
        else rejected = "outside-room";
      }
    } else if (pick.kind === "none") prevPx.delete(w.id);
    const track = stepTrack(state.tracks.get(w.id) ?? LOST, t, raw, cfg.tracker ?? DEFAULT_TRACKER);
    tracks.set(w.id, track);
    return {
      id: w.id,
      pick: pick.kind,
      blob: pick.kind === "found" ? pick.blob : undefined,
      imagePx,
      raw,
      rejected,
      track,
      mask: det.mask,
      candidates: det.blobs.length,
    };
  });
  const pick = (get: (t: WorkerTrack) => Vec2 | undefined) =>
    workers.flatMap((r) => {
      const p = get(r.track);
      return p ? [{ workerId: r.id, x: p.x, z: p.z }] : [];
    });
  return { state: { tracks, prevPx }, workers, planes, samples: pick(reported), fresh: pick(recorded) };
}
