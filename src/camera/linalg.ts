/**
 * Tiny dense linear algebra for calibration: 3x3 matrices (row-major tuples)
 * and least squares by normal equations with partial pivoting.
 */

/** Row-major 3x3 matrix. */
export type Mat3 = readonly [number, number, number, number, number, number, number, number, number];
export type V3 = readonly [number, number, number];

export const IDENTITY3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function mul3(a: Mat3, b: Mat3): Mat3 {
  const r = (i: number, j: number) => a[i * 3]! * b[j]! + a[i * 3 + 1]! * b[3 + j]! + a[i * 3 + 2]! * b[6 + j]!;
  return [r(0, 0), r(0, 1), r(0, 2), r(1, 0), r(1, 1), r(1, 2), r(2, 0), r(2, 1), r(2, 2)];
}

export function mulVec3(m: Mat3, v: V3): V3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

export function det3(m: Mat3): number {
  return m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
}

/** Inverse, or undefined when (numerically) singular. */
export function inv3(m: Mat3): Mat3 | undefined {
  const d = det3(m);
  const scale = Math.max(...m.map(Math.abs));
  if (!Number.isFinite(d) || scale === 0 || Math.abs(d) < 1e-12 * scale ** 3) return undefined;
  const c = (a: number, b: number, e: number, f: number) => (a * f - b * e) / d;
  return [
    c(m[4], m[5], m[7], m[8]), -c(m[1], m[2], m[7], m[8]), c(m[1], m[2], m[4], m[5]),
    -c(m[3], m[5], m[6], m[8]), c(m[0], m[2], m[6], m[8]), -c(m[0], m[2], m[3], m[5]),
    c(m[3], m[4], m[6], m[7]), -c(m[0], m[1], m[6], m[7]), c(m[0], m[1], m[3], m[4]),
  ];
}

export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const norm = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export const scaleV = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const addV = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const subV = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** Solves the square system A x = b (A as rows). Undefined if singular. */
export function solveSquare(a: readonly (readonly number[])[], b: readonly number[]): number[] | undefined {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  const scale = Math.max(1e-300, ...a.flat().map(Math.abs));
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) if (Math.abs(m[r]![col]!) > Math.abs(m[pivot]![col]!)) pivot = r;
    if (Math.abs(m[pivot]![col]!) < 1e-12 * scale) return undefined;
    [m[col], m[pivot]] = [m[pivot]!, m[col]!];
    const p = m[col]!;
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const row = m[r]!;
      const f = row[col]! / p[col]!;
      if (f !== 0) for (let k = col; k <= n; k += 1) row[k] = row[k]! - f * p[k]!;
    }
  }
  return m.map((row, i) => row[n]! / row[i]!);
}

/** Least squares min |A x - b| via the normal equations. Undefined if rank-deficient. */
export function leastSquares(a: readonly (readonly number[])[], b: readonly number[]): number[] | undefined {
  const n = a[0]?.length ?? 0;
  if (n === 0 || a.length < n) return undefined;
  const ata = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => a.reduce((s, row) => s + row[i]! * row[j]!, 0)),
  );
  const atb = Array.from({ length: n }, (_, i) => a.reduce((s, row, k) => s + row[i]! * b[k]!, 0));
  return solveSquare(ata, atb);
}
