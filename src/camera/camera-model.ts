/**
 * From a floor homography to "where is the person whose hat is at this pixel".
 *
 * The hat is about 1.65 m above the floor, not on it. Pushing a hat pixel
 * through the floor homography lands where the camera ray hits the floor,
 * which is far behind the person (metres, for a camera 3 m up). So we build
 * the camera's full 3x4 projection P = [p1 p2 p3 p4] for world (x, y, z, 1):
 * the floor homography gives three columns exactly (H = [p1 p3 p4]); the
 * missing one, p2, is the image direction of "up". With it, the plane at
 * height h has homography [p1, p3, h p2 + p4], and inverting that maps a hat
 * pixel straight to the floor point under the hat.
 *
 * Two ways to get p2, both from clicks the operator already makes:
 *
 * 1. "box-tops" (preferred when available): the operator also matches two or
 *    more top corners of boxes whose heights the scan knows. Each gives two
 *    linear equations in p2. Exact for any pinhole camera.
 * 2. "lens" (floor points only, the fallback): assume square pixels and the
 *    principal point at the image centre. The floor's x and z axes must be
 *    perpendicular and equally scaled in 3D, which fixes the focal length;
 *    the pose follows (a standard planar calibration) and p2 = K r_y. This is
 *    fragile: for a camera facing the counter squarely, a principal point
 *    5 px off horizontally already costs about 11 cm (measured in
 *    camera-model.test.ts), and phone lenses are not guaranteed centred. The
 *    UI therefore labels it "approximate" and asks for two box tops.
 *
 * The bigger error on the day is the hat height itself: a hat dh higher than
 * assumed moves the dot by dh * d / (C - h), where C is the camera height and
 * d the horizontal distance from camera to person. Camera 2.9 m up, person
 * 3.5 m away: 10 cm of hat height is about 28 cm on the floor. Hence per-
 * worker hat heights, and a camera mounted as high as possible.
 */
import type { Vec2, Vec3 } from "../core/types";
import { applyHomography, type Pt } from "./homography";
import { cross, inv3, leastSquares, mulVec3, norm, scaleV, solveSquare, type Mat3, type V3 } from "./linalg";
import { fail, ok, type Result } from "./result";

export type HeightMethod = "lens" | "box-tops";

export interface CameraModel {
  /** Floor (x, z, 1) to image pixels. */
  readonly floorToImage: Mat3;
  /** Image direction of world "up", in the same scale as floorToImage. */
  readonly up: V3;
  readonly method: HeightMethod;
  /** Plain words about any assumption made, for the operator. */
  readonly note: string;
}

export interface TopPoint {
  readonly world: Vec3;
  readonly image: Pt;
}

const col = (h: Mat3, j: number): V3 => [h[j]!, h[3 + j]!, h[6 + j]!];

/** Floor (x, z) at height h to image. */
export function heightHomography(m: CameraModel, h: number): Mat3 {
  const f = m.floorToImage;
  const u = m.up;
  return [f[0], f[1], f[2] + h * u[0], f[3], f[4], f[5] + h * u[1], f[6], f[7], f[8] + h * u[2]];
}

/** Where a point at height h above floor point (x, z) appears in the image. */
export function projectAt(m: CameraModel, p: Vec2, h: number): Pt | undefined {
  return applyHomography(heightHomography(m, h), { x: p.x, y: p.z });
}

/** The floor point under a thing seen at pixel px that is h metres up. */
export function imageToFloorAt(m: CameraModel, px: Pt, h: number): Vec2 | undefined {
  const inv = inv3(heightHomography(m, h));
  if (!inv) return undefined;
  const q = applyHomography(inv, px);
  return q && Number.isFinite(q.x) && Number.isFinite(q.y) ? { x: q.x, z: q.y } : undefined;
}

/** The camera's position: the null vector of P. */
export function cameraPosition(m: CameraModel): Vec3 | undefined {
  const f = m.floorToImage;
  const a = [0, 1, 2].map((i) => [f[i * 3]!, m.up[i]!, f[i * 3 + 1]!]);
  const b = [0, 1, 2].map((i) => -f[i * 3 + 2]!);
  const s = solveSquare(a, b);
  return s ? { x: s[0]!, y: s[1]!, z: s[2]! } : undefined;
}

const MIN_F = 0.2;
const MAX_F = 6;

/**
 * Focal length from two constraints on omega = 1/f^2: the floor's x and z axes
 * are perpendicular, and equally long, in 3D. Each alone is ill-conditioned
 * for some poses (the first when an axis is parallel to the image, as with a
 * camera facing a wall squarely), so both are normalised and combined by
 * least squares.
 */
function focalFrom(g1: V3, g2: V3, width: number): number | undefined {
  const eqs: readonly (readonly [number, number])[] = [
    [g1[0] * g2[0] + g1[1] * g2[1], g1[2] * g2[2]],
    [g1[0] ** 2 + g1[1] ** 2 - g2[0] ** 2 - g2[1] ** 2, g1[2] ** 2 - g2[2] ** 2],
  ];
  // a * omega + b = 0, with omega rescaled by width^2 for conditioning.
  let num = 0;
  let den = 0;
  for (const [a0, b] of eqs) {
    const a = a0 / width ** 2;
    const n = Math.hypot(a, b);
    if (n === 0) continue;
    num += (a / n) * (b / n);
    den += (a / n) ** 2;
  }
  if (den < 1e-9) return undefined;
  const omega = -num / den / width ** 2;
  const f = 1 / Math.sqrt(omega);
  return Number.isFinite(f) && f > MIN_F * width && f < MAX_F * width ? f : undefined;
}

/**
 * Builds the camera model from the floor homography alone (method "lens").
 * `refFloor` is any floor point in view (e.g. the centroid of the clicked
 * points); it tells which side of the camera is in front.
 */
export function modelFromLens(
  floorToImage: Mat3,
  size: { readonly width: number; readonly height: number },
  refFloor: Vec2,
): Result<CameraModel> {
  const cx = size.width / 2;
  const cy = size.height / 2;
  // G = T H, with T moving the principal point to the origin.
  const shift = (v: V3): V3 => [v[0] - cx * v[2], v[1] - cy * v[2], v[2]];
  const g1 = shift(col(floorToImage, 0));
  const g2 = shift(col(floorToImage, 1));
  const found = focalFrom(g1, g2, size.width);
  const f = found ?? size.width;
  const a: V3 = [g1[0] / f, g1[1] / f, g1[2]];
  const b: V3 = [g2[0] / f, g2[1] / f, g2[2]];
  const wRef = floorToImage[6] * refFloor.x + floorToImage[7] * refFloor.z + floorToImage[8];
  if (!Number.isFinite(wRef) || wRef === 0) return fail("The calibration does not see the floor. Redo the floor points.");
  const s = (Math.sign(wRef) * 2) / (norm(a) + norm(b));
  const rx = scaleV(a, s);
  const rz = scaleV(b, s);
  const ryRaw = cross(rz, rx);
  const ry = scaleV(ryRaw, 1 / norm(ryRaw));
  // p2 in G scale is K0 ry / s; undo the shift.
  const pg: V3 = [(f * ry[0]) / s, (f * ry[1]) / s, ry[2] / s];
  const up: V3 = [pg[0] + cx * pg[2], pg[1] + cy * pg[2], pg[2]];
  const note = found
    ? `Hat height correction assumes a centred lens (focal length about ${Math.round(f)} px).`
    : `Focal length could not be measured from these points (camera looking almost straight down?); assumed ${Math.round(f)} px. Add two box-top points for an exact answer.`;
  if (!up.every(Number.isFinite)) return fail("Could not work out the camera's angle. Redo the floor points.");
  return ok({ floorToImage, up, method: "lens", note });
}

/**
 * Builds the camera model from the floor homography plus two or more points
 * of known height (box top corners). Exact for any pinhole camera.
 * For each top point u ~ H (x, z, 1) + y p2, giving two linear equations in p2.
 */
export function modelFromTops(floorToImage: Mat3, tops: readonly TopPoint[]): Result<CameraModel> {
  const usable = tops.filter((t) => t.world.y > 0.2);
  if (usable.length < 2) return fail("Need two or more box-top points (at least 20 cm above the floor).");
  const rows: number[][] = [];
  const rhs: number[] = [];
  for (const t of usable) {
    const [qx, qy, qw] = mulVec3(floorToImage, [t.world.x, t.world.z, 1]);
    const { x: u, y: v } = t.image;
    const h = t.world.y;
    rows.push([0, -h, v * h]);
    rhs.push(qy - v * qw);
    rows.push([h, 0, -u * h]);
    rhs.push(u * qw - qx);
  }
  // Scale columns so pixel-sized and unit-sized entries are balanced.
  const sc = rows.reduce((m, r) => Math.max(m, Math.abs(r[0]!), Math.abs(r[1]!)), 1);
  const scaled = rows.map((r) => [r[0]! / sc, r[1]! / sc, r[2]! / sc]);
  const sol = leastSquares(scaled, rhs);
  if (!sol) return fail("The box-top points do not fix the camera's angle. Use tops of two different boxes.");
  const up: V3 = [sol[0]! / sc, sol[1]! / sc, sol[2]! / sc];
  if (!up.every(Number.isFinite)) return fail("The box-top points do not fix the camera's angle.");
  return ok({ floorToImage, up, method: "box-tops", note: `Hat height correction measured from ${usable.length} box-top points.` });
}

/**
 * Measures a hat's height: a worker stands on a known floor point and the
 * operator clicks the hat. Solves u ~ H (x, z, 1) + h p2 for h (least squares).
 */
export function solveHatHeight(m: CameraModel, hatPx: Pt, standing: Vec2): Result<number> {
  const [qx, qy, qw] = mulVec3(m.floorToImage, [standing.x, standing.z, 1]);
  const { x: u, y: v } = hatPx;
  const [px, py, pw] = m.up;
  const a = [v * pw - py, px - u * pw];
  const b = [qy - v * qw, u * qw - qx];
  const den = a[0]! ** 2 + a[1]! ** 2;
  if (den === 0) return fail("Could not measure the hat height from this click.");
  const h = (a[0]! * b[0]! + a[1]! * b[1]!) / den;
  if (!Number.isFinite(h) || h < 1 || h > 2.3) {
    return fail(`That click gives a hat ${h.toFixed(2)} m up, which is not plausible. Check the worker is on the chosen spot.`);
  }
  return ok(h);
}
