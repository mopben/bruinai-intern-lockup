/**
 * Colour space and hat-colour targets.
 *
 * Hue survives moderate lighting change far better than RGB: a red hat in
 * shade is darker and a little greyer, but still red. So a pixel matches a
 * hat when its hue is near the target's and it is colourful (saturation) and
 * bright (value) enough. The floor-relative limits follow the target so a
 * sampled, slightly dull hat still matches itself.
 */
import { fail, ok, type Result } from "./result";

export interface Hsv {
  /** Degrees, 0 to 360. */
  readonly h: number;
  /** 0 to 1. */
  readonly s: number;
  /** 0 to 1. */
  readonly v: number;
}

export interface ColorTarget extends Hsv {
  /** Where it came from: the layout's hex, or sampled from the camera. */
  readonly source: "layout" | "sampled";
}

export interface Thresholds {
  /** Max hue difference, degrees. */
  readonly hueTol: number;
  /** Absolute floors for saturation and value. */
  readonly minSat: number;
  readonly minVal: number;
  /** Relative floors: a pixel needs at least this fraction of the target's s and v. */
  readonly relSat: number;
  readonly relVal: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = { hueTol: 16, minSat: 0.35, minVal: 0.18, relSat: 0.55, relVal: 0.35 };

export function hexToRgb(hex: string): { r: number; g: number; b: number } | undefined {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return undefined;
  const n = parseInt(m[1]!, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHsv(r: number, g: number, b: number): Hsv {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const v = max / 255;
  const s = max === 0 ? 0 : d / max;
  if (d === 0) return { h: 0, s, v };
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return { h: h < 0 ? h + 360 : h, s, v };
}

export function hsvToRgb({ h, s, v }: Hsv): { r: number; g: number; b: number } {
  const c = v * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] =
    hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = v - c;
  return { r: Math.round((r1 + m) * 255), g: Math.round((g1 + m) * 255), b: Math.round((b1 + m) * 255) };
}

export function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

export function targetFromHex(hex: string): Result<ColorTarget> {
  const rgb = hexToRgb(hex);
  if (!rgb) return fail(`"${hex}" is not a colour like #e8312f.`);
  return ok({ ...rgbToHsv(rgb.r, rgb.g, rgb.b), source: "layout" });
}

export function matches(t: Hsv, th: Thresholds, h: number, s: number, v: number): boolean {
  return (
    hueDistance(h, t.h) <= th.hueTol &&
    s >= Math.max(th.minSat, t.s * th.relSat) &&
    v >= Math.max(th.minVal, t.v * th.relVal)
  );
}

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};

/**
 * A target from the pixels around a click on a hat. Uses only colourful
 * pixels (so a click near the edge ignores the background), circular mean
 * of hue, median saturation and value.
 */
export function targetFromSamples(pixels: readonly Hsv[]): Result<ColorTarget> {
  const colourful = pixels.filter((p) => p.s >= 0.3 && p.v >= 0.15);
  if (colourful.length < Math.max(4, pixels.length * 0.2)) {
    return fail("That spot is not colourful enough. Click the middle of the hat.");
  }
  const sx = colourful.reduce((a, p) => a + Math.cos((p.h * Math.PI) / 180), 0);
  const sy = colourful.reduce((a, p) => a + Math.sin((p.h * Math.PI) / 180), 0);
  const h = ((Math.atan2(sy, sx) * 180) / Math.PI + 360) % 360;
  // Keep the dominant hue cluster only (a click may straddle two colours).
  const near = colourful.filter((p) => hueDistance(p.h, h) <= 25);
  if (near.length < colourful.length * 0.6) return fail("That spot mixes two colours. Click the middle of the hat.");
  return ok({ h, s: median(near.map((p) => p.s)), v: median(near.map((p) => p.v)), source: "sampled" });
}
