/**
 * A pinhole camera built from a pose. Used by the tests and the synthetic
 * video generator to know the true answer; the tracker itself never knows
 * the pose and recovers what it needs from clicked points (camera-model.ts).
 *
 * World: x right, y up, z toward the viewer (the scan's frame).
 * Image: x right, y down, pixels.
 */
import type { Vec3 } from "../core/types";
import type { Pt } from "./homography";
import { cross, dot, norm, scaleV, subV, type V3 } from "./linalg";

/** Row-major 3x4 projection matrix. */
export type Mat34 = readonly number[];

export interface CameraPose {
  readonly position: Vec3;
  readonly target: Vec3;
  readonly focalPx: number;
  readonly width: number;
  readonly height: number;
  /** Principal point; default the image centre. */
  readonly cx?: number;
  readonly cy?: number;
}

const v3 = (p: Vec3): V3 => [p.x, p.y, p.z];
const unit = (a: V3): V3 => scaleV(a, 1 / norm(a));

export function cameraMatrix(pose: CameraPose): Mat34 {
  const c = v3(pose.position);
  const f = unit(subV(v3(pose.target), c));
  const right = unit(cross(f, [0, 1, 0]));
  const down = cross(f, right);
  const rows = [right, down, f];
  const t = rows.map((r) => -dot(r, c));
  const k = [pose.focalPx, 0, pose.cx ?? pose.width / 2, 0, pose.focalPx, pose.cy ?? pose.height / 2, 0, 0, 1];
  const rt = rows.map((r, i) => [r[0], r[1], r[2], t[i]!]);
  const out: number[] = [];
  for (let i = 0; i < 3; i += 1)
    for (let j = 0; j < 4; j += 1) out.push(k[i * 3]! * rt[0]![j]! + k[i * 3 + 1]! * rt[1]![j]! + k[i * 3 + 2]! * rt[2]![j]!);
  return out;
}

/** Homogeneous image coordinates (third value = depth for a proper P). */
export function projectH(p: Mat34, x: Vec3): V3 {
  const r = (i: number) => p[i * 4]! * x.x + p[i * 4 + 1]! * x.y + p[i * 4 + 2]! * x.z + p[i * 4 + 3]!;
  return [r(0), r(1), r(2)];
}

/** Pixel position, or undefined if the point is behind the camera. */
export function project(p: Mat34, x: Vec3): Pt | undefined {
  const [u, v, w] = projectH(p, x);
  return w > 1e-6 ? { x: u / w, y: v / w } : undefined;
}

export function depth(p: Mat34, x: Vec3): number {
  return projectH(p, x)[2];
}
