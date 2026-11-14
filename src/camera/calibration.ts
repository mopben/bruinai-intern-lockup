/**
 * A calibration is the operator's clicked point pairs plus hat heights. This
 * turns it into a camera model and per-point errors in centimetres.
 */
import type { Vec2, Vec3 } from "../core/types";
import { imageToFloorAt, modelFromLens, modelFromTops, type CameraModel } from "./camera-model";
import { solveHomography, type Pt } from "./homography";
import { fail, ok, type Result } from "./result";

export interface PointPair {
  /** RefPoint id, if picked from the suggestions. */
  readonly refId?: string;
  readonly label: string;
  readonly world: Vec3;
  readonly image: Pt;
}

export interface SolvedCalibration {
  readonly model: CameraModel;
  /** Per pair: distance on the floor between where its click maps and where it should be, cm. */
  readonly errorsCm: readonly number[];
  /**
   * Index of the pair that is most likely a wrong click, if one clearly is:
   * leaving it out makes every other point fit much better. In-sample errors
   * alone spread one bad click over all the points.
   */
  readonly suspect?: number;
  readonly rmsCm: number;
  readonly floorCount: number;
  readonly topCount: number;
}

/** Points within this of the floor count as floor points. */
const FLOOR_EPS_M = 0.01;
export const MIN_FLOOR_POINTS = 4;
export const MIN_TOP_POINTS = 2;

function errorOf(model: CameraModel, p: PointPair): number {
  const g = imageToFloorAt(model, p.image, p.world.y);
  return g ? Math.hypot(g.x - p.world.x, g.z - p.world.z) * 100 : Number.POSITIVE_INFINITY;
}

export function solveCalibration(pairs: readonly PointPair[], size: { width: number; height: number }): Result<SolvedCalibration> {
  const base = solveModel(pairs, size);
  if (!base.ok) return fail(base.error);
  const { model, floorCount, topCount } = base.value;
  const errorsCm = pairs.map((p) => errorOf(model, p));
  const rmsCm = Math.sqrt(errorsCm.reduce((s, e) => s + e * e, 0) / errorsCm.length);
  return ok({ model, errorsCm, rmsCm, floorCount, topCount, suspect: findSuspect(pairs, size, rmsCm, floorCount, topCount) });
}

/** Wrong clicks worth flagging are at least this far off, cm. */
const SUSPECT_MIN_CM = 5;

function findSuspect(
  pairs: readonly PointPair[],
  size: { width: number; height: number },
  rmsCm: number,
  floorCount: number,
  topCount: number,
): number | undefined {
  if (rmsCm < SUSPECT_MIN_CM / 2) return undefined;
  let best: { i: number; rms: number } | undefined;
  pairs.forEach((p, i) => {
    const isTop = p.world.y > FLOOR_EPS_M;
    if (isTop ? topCount <= MIN_TOP_POINTS : floorCount <= MIN_FLOOR_POINTS) return;
    const rest = [...pairs.slice(0, i), ...pairs.slice(i + 1)];
    const m = solveModel(rest, size);
    if (!m.ok) return;
    const rms = Math.sqrt(rest.reduce((s, q) => s + errorOf(m.value.model, q) ** 2, 0) / rest.length);
    if (!best || rms < best.rms) best = { i, rms };
  });
  if (!best) return undefined;
  const { i, rms } = best;
  const own = solveModel([...pairs.slice(0, i), ...pairs.slice(i + 1)], size);
  const ownErr = own.ok ? errorOf(own.value.model, pairs[i]!) : 0;
  return rms < rmsCm * 0.5 && ownErr > SUSPECT_MIN_CM ? i : undefined;
}

function solveModel(
  pairs: readonly PointPair[],
  size: { width: number; height: number },
): Result<{ model: CameraModel; floorCount: number; topCount: number }> {
  const floor = pairs.filter((p) => Math.abs(p.world.y) <= FLOOR_EPS_M);
  const tops = pairs.filter((p) => p.world.y > FLOOR_EPS_M);
  if (floor.length < MIN_FLOOR_POINTS) {
    return fail(`Match ${MIN_FLOOR_POINTS - floor.length} more floor point${MIN_FLOOR_POINTS - floor.length === 1 ? "" : "s"} (at least ${MIN_FLOOR_POINTS}).`);
  }
  const h = solveHomography(
    floor.map((p) => ({ x: p.world.x, y: p.world.z })),
    floor.map((p) => p.image),
  );
  if (!h.ok) return fail(h.error);
  const centroid: Vec2 = {
    x: floor.reduce((s, p) => s + p.world.x, 0) / floor.length,
    z: floor.reduce((s, p) => s + p.world.z, 0) / floor.length,
  };
  const model =
    tops.length >= MIN_TOP_POINTS
      ? modelFromTops(h.value, tops.map((p) => ({ world: p.world, image: p.image })))
      : modelFromLens(h.value, size, centroid);
  if (!model.ok) return fail(model.error);
  return ok({ model: model.value, floorCount: floor.length, topCount: tops.length });
}
