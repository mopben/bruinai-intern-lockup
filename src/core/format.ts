/**
 * Formatting for honesty: no more precision than the numbers have.
 * Ranges are rounded outward so rounding never makes them look tighter.
 */
import type { Range } from "./stats";

const EN_DASH = "–";

/** Rounding step for seconds: whole seconds below 100 s, else 5 s. */
export function secondsStep(value: number): number {
  return Math.abs(value) < 100 ? 1 : 5;
}

/** "21 s", or "2 min 5 s" from 120 s up. */
export function formatSeconds(s: number): string {
  if (!Number.isFinite(s)) return "—";
  const step = secondsStep(s);
  const r = Math.round(s / step) * step;
  if (r < 120) return `${r} s`;
  const m = Math.floor(r / 60);
  const rest = r - m * 60;
  return rest === 0 ? `${m} min` : `${m} min ${rest} s`;
}

/** "18–26 s" from a low and high value, rounded outward. "about 20 s" when they round together. */
export function formatSecondsRange(lo: number, hi: number): string {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return "—";
  const a = Math.min(lo, hi);
  const b = Math.max(lo, hi);
  const step = secondsStep(b);
  const rl = Math.floor(a / step) * step;
  const rh = Math.ceil(b / step) * step;
  if (rh - rl <= step && Math.round(a / step) === Math.round(b / step)) return `about ${Math.round(b / step) * step} s`;
  return `${rl}${EN_DASH}${rh} s`;
}

/** A p10–p90 range as seconds. */
export function formatRange(r: Range): string {
  return formatSecondsRange(r.p10, r.p90);
}

/** "12.3 m". */
export function formatMetres(m: number): string {
  if (!Number.isFinite(m)) return "—";
  return `${(Math.round(m * 10) / 10).toFixed(1)} m`;
}

/** Whole percent, signed only when asked: "8%" or "+8%" / "−8%". */
export function formatPercent(p: number, signed = false): string {
  if (!Number.isFinite(p)) return "—";
  const r = Math.round(p);
  if (!signed || r === 0) return `${Math.abs(r)}%`;
  return r > 0 ? `+${r}%` : `−${Math.abs(r)}%`;
}

/** Plain words for a trust error: "The model was 8% slower than the real run." */
export function describeTrustError(errorPct: number | null): string {
  if (errorPct === null || !Number.isFinite(errorPct)) return "We could not check the model on this run.";
  const r = Math.round(errorPct);
  if (r === 0) return "The model matched the real run to within 1%.";
  return `The model was ${Math.abs(r)}% ${r > 0 ? "slower" : "faster"} than the real run.`;
}

/** A small count range: "7–9 orders" or "8 orders". */
export function formatCountRange(r: Range, noun = "orders"): string {
  const lo = Math.floor(r.p10);
  const hi = Math.ceil(r.p90);
  return lo === hi ? `${lo} ${noun}` : `${lo}${EN_DASH}${hi} ${noun}`;
}
