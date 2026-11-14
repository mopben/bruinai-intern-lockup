/** Small statistics helpers. Inputs are never mutated. */

/** p10 / p50 / p90 of a set of values. */
export interface Range {
  readonly p10: number;
  readonly p50: number;
  readonly p90: number;
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

/** Quantile with linear interpolation between order statistics (type 7). */
export function quantileSorted(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo] as number;
  const b = sorted[hi] as number;
  return a + (b - a) * (pos - lo);
}

export function quantile(values: readonly number[], q: number): number {
  return quantileSorted([...values].sort((x, y) => x - y), q);
}

export function median(values: readonly number[]): number {
  return quantile(values, 0.5);
}

export function rangeOf(values: readonly number[]): Range {
  const sorted = [...values].sort((x, y) => x - y);
  return { p10: quantileSorted(sorted, 0.1), p50: quantileSorted(sorted, 0.5), p90: quantileSorted(sorted, 0.9) };
}
