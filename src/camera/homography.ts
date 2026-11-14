/**
 * Plane-to-plane homography from four or more point pairs.
 *
 * Method: normalised DLT (Hartley). Both point sets are shifted to their
 * centroid and scaled to mean distance sqrt(2); then H with h33 = 1 is found
 * by linear least squares (2 equations per pair). Fixing h33 = 1 is safe after
 * normalisation because it only fails if the source centroid maps to
 * infinity, which cannot happen for floor points the camera can see.
 */
import { inv3, leastSquares, mul3, det3, type Mat3 } from "./linalg";
import { fail, ok, type Result } from "./result";

export interface Pt {
  readonly x: number;
  readonly y: number;
}

/** Projects p through h. Undefined if the point maps to infinity. */
export function applyHomography(h: Mat3, p: Pt): Pt | undefined {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  if (!Number.isFinite(w) || Math.abs(w) < 1e-12) return undefined;
  return { x: (h[0] * p.x + h[1] * p.y + h[2]) / w, y: (h[3] * p.x + h[4] * p.y + h[5]) / w };
}

function normaliser(points: readonly Pt[]): Mat3 {
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
  const meanDist = points.reduce((s, p) => s + Math.hypot(p.x - cx, p.y - cy), 0) / points.length;
  const s = Math.SQRT2 / meanDist;
  return [s, 0, -s * cx, 0, s, -s * cy, 0, 0, 1];
}

/** Smallest spread of a point set relative to its largest (0 = all on a line). */
function flatness(points: readonly Pt[]): number {
  const n = points.length;
  const cx = points.reduce((s, p) => s + p.x, 0) / n;
  const cy = points.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of points) {
    sxx += (p.x - cx) ** 2;
    syy += (p.y - cy) ** 2;
    sxy += (p.x - cx) * (p.y - cy);
  }
  const tr = sxx + syy;
  const disc = Math.sqrt(Math.max(0, ((sxx - syy) / 2) ** 2 + sxy * sxy));
  const big = tr / 2 + disc;
  return big <= 0 ? 0 : (tr / 2 - disc) / big;
}

function hasThreeInLine(points: readonly Pt[], relTol: number): boolean {
  const scale = Math.max(...points.flatMap((p) => [Math.abs(p.x), Math.abs(p.y)]), 1e-9);
  const spread = Math.max(
    ...points.flatMap((a) => points.map((b) => Math.hypot(a.x - b.x, a.y - b.y))),
    1e-9 * scale,
  );
  for (let i = 0; i < points.length; i += 1)
    for (let j = i + 1; j < points.length; j += 1)
      for (let k = j + 1; k < points.length; k += 1) {
        const [a, b, c] = [points[i]!, points[j]!, points[k]!];
        const area2 = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
        if (area2 < relTol * spread * spread) return true;
      }
  return false;
}

function checkPoints(src: readonly Pt[], dst: readonly Pt[]): string | undefined {
  if (src.length !== dst.length) return "Each floor point needs exactly one matching camera point.";
  if (src.length < 4) return `Need at least four point pairs; there are ${src.length}.`;
  if (![...src, ...dst].every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) return "A point is not a number.";
  for (const set of [src, dst]) {
    const keys = new Set(set.map((p) => `${p.x.toFixed(6)},${p.y.toFixed(6)}`));
    if (keys.size !== set.length) return "Two points are in the same place. Use four different points.";
    if (flatness(set) < 1e-4) return "The points lie on one line. Spread them out over the floor.";
    if (set.length === 4 && hasThreeInLine(set, 2e-3)) return "Three of the four points are in a line. Pick points that form a box shape.";
  }
  return undefined;
}

/** Finds H with dst ~ H src. Errors are written for the operator. */
export function solveHomography(src: readonly Pt[], dst: readonly Pt[]): Result<Mat3> {
  const problem = checkPoints(src, dst);
  if (problem) return fail(problem);
  const ts = normaliser(src);
  const td = normaliser(dst);
  const ns = src.map((p) => applyHomography(ts, p)!);
  const nd = dst.map((p) => applyHomography(td, p)!);
  const rows: number[][] = [];
  const rhs: number[] = [];
  ns.forEach((s, i) => {
    const d = nd[i]!;
    rows.push([s.x, s.y, 1, 0, 0, 0, -d.x * s.x, -d.x * s.y]);
    rhs.push(d.x);
    rows.push([0, 0, 0, s.x, s.y, 1, -d.y * s.x, -d.y * s.y]);
    rhs.push(d.y);
  });
  const h = leastSquares(rows, rhs);
  if (!h) return fail("These points do not fix the floor. Pick points that are spread out, not in a line.");
  const hn: Mat3 = [h[0]!, h[1]!, h[2]!, h[3]!, h[4]!, h[5]!, h[6]!, h[7]!, 1];
  const tdInv = inv3(td);
  if (!tdInv) return fail("Calibration points are degenerate.");
  const full = mul3(tdInv, mul3(hn, ts));
  const s = full[8] !== 0 ? full[8] : 1;
  const out = full.map((v) => v / s) as unknown as Mat3;
  const scale = Math.max(...out.map(Math.abs));
  if (!out.every(Number.isFinite) || Math.abs(det3(out)) < 1e-12 * scale ** 3) {
    return fail("These points do not fix the floor. Check that each map point matches the same spot in the picture.");
  }
  return ok(out);
}

/** Distance between H src and dst for each pair (in dst units). */
export function reprojectionErrors(h: Mat3, src: readonly Pt[], dst: readonly Pt[]): readonly number[] {
  return src.map((s, i) => {
    const q = applyHomography(h, s);
    const d = dst[i]!;
    return q ? Math.hypot(q.x - d.x, q.y - d.y) : Number.POSITIVE_INFINITY;
  });
}
