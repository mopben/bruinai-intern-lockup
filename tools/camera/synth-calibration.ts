/**
 * The synthetic operator: picks reference points the camera can actually
 * see, and "clicks" them with a little hand error, producing the same
 * calibration file the page exports.
 */
import type { Vec2, Vec3 } from "../../src/core/types";
import { CALIBRATION_FORMAT, type CalibrationFile } from "../../src/camera/calib-file";
import type { PointPair } from "../../src/camera/calibration";
import type { RefPoint } from "../../src/camera/kitchen";
import { cameraMatrix, project, type CameraPose } from "../../src/camera/pinhole";
import { mulberry32, type Rng } from "../../src/core/rng";
import type { Prism, StaticScene } from "./scene";

function insidePolygon(poly: readonly Vec2[], p: Vec2): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

const shrink = (pr: Prism, m: number): readonly Vec2[] => {
  const n = pr.base.length;
  const cx = pr.base.reduce((s, q) => s + q.x, 0) / n;
  const cz = pr.base.reduce((s, q) => s + q.z, 0) / n;
  return pr.base.map((q) => {
    const d = Math.hypot(q.x - cx, q.z - cz);
    return { x: q.x + ((cx - q.x) * m) / d, z: q.z + ((cz - q.z) * m) / d };
  });
};

/** True if nothing solid lies between the camera and the point. */
export function visible(scene: StaticScene, pose: CameraPose, w: Vec3): boolean {
  const c = pose.position;
  const solids = scene.prisms.map((pr) => ({ pr, poly: shrink(pr, 0.02) }));
  for (let k = 1; k < 80; k += 1) {
    const s = k / 80;
    const q = { x: c.x + s * (w.x - c.x), y: c.y + s * (w.y - c.y), z: c.z + s * (w.z - c.z) };
    for (const { pr, poly } of solids) if (q.y > pr.y0 + 0.01 && q.y < pr.y1 - 0.01 && insidePolygon(poly, { x: q.x, z: q.z })) return false;
  }
  const px = project(cameraMatrix(pose), w);
  return px !== undefined && px.x > 10 && px.y > 10 && px.x < pose.width - 10 && px.y < pose.height - 10;
}

/** Farthest-point selection: n refs spread over the floor. */
function spread(refs: readonly RefPoint[], n: number): RefPoint[] {
  if (refs.length === 0) return [];
  const chosen: RefPoint[] = [refs[0]!];
  while (chosen.length < Math.min(n, refs.length)) {
    const d = (r: RefPoint) => Math.min(...chosen.map((c) => Math.hypot(c.world.x - r.world.x, c.world.z - r.world.z)));
    const next = refs.filter((r) => !chosen.includes(r)).sort((a, b) => d(b) - d(a))[0]!;
    chosen.push(next);
  }
  return chosen;
}

const gauss = (rng: Rng) => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());

export interface SynthCalibrationOptions {
  readonly floorPoints: number;
  readonly topPoints: number;
  /** Hand error of each click, pixels (sd per axis). */
  readonly clickSigmaPx: number;
  readonly seed: number;
  readonly cameraKey: string;
  readonly hatHeights: Readonly<Record<string, number>>;
}

export function synthCalibration(scene: StaticScene, pose: CameraPose, o: SynthCalibrationOptions): CalibrationFile {
  const p = cameraMatrix(pose);
  const rng = mulberry32(o.seed);
  const seen = scene.view.refs.filter((r) => visible(scene, pose, r.world));
  const picks = [...spread(seen.filter((r) => r.kind === "floor"), o.floorPoints), ...spread(seen.filter((r) => r.kind === "top"), o.topPoints)];
  const pairs: PointPair[] = picks.map((r) => {
    const px = project(p, r.world)!;
    return { refId: r.id, label: r.label, world: r.world, image: { x: px.x + gauss(rng) * o.clickSigmaPx, y: px.y + gauss(rng) * o.clickSigmaPx } };
  });
  return {
    format: CALIBRATION_FORMAT,
    version: 1,
    savedAt: new Date().toISOString(),
    cameraKey: o.cameraKey,
    kitchenKey: scene.view.key,
    imageSize: { width: pose.width, height: pose.height },
    pairs,
    hatHeights: o.hatHeights,
    colours: {},
  };
}
