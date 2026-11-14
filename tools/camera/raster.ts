/**
 * A tiny software rasteriser for the synthetic camera: filled polygons and
 * ellipses into a float RGB buffer, then blur, noise and quantise to RGBA.
 * Buffers are mutated in place (pixel data).
 */
import type { Pt } from "../../src/camera/homography";
import type { Rng } from "../../src/core/rng";

export type Rgb = readonly [number, number, number];

export interface Canvas {
  readonly width: number;
  readonly height: number;
  /** RGB floats 0..255, row-major. */
  readonly rgb: Float32Array;
}

export const createCanvas = (width: number, height: number): Canvas => ({ width, height, rgb: new Float32Array(width * height * 3) });

function put(c: Canvas, x: number, y: number, col: Rgb, alpha: number) {
  const i = (y * c.width + x) * 3;
  if (alpha >= 1) {
    c.rgb[i] = col[0];
    c.rgb[i + 1] = col[1];
    c.rgb[i + 2] = col[2];
  } else {
    c.rgb[i] = c.rgb[i]! * (1 - alpha) + col[0] * alpha;
    c.rgb[i + 1] = c.rgb[i + 1]! * (1 - alpha) + col[1] * alpha;
    c.rgb[i + 2] = c.rgb[i + 2]! * (1 - alpha) + col[2] * alpha;
  }
}

/** Even-odd scanline fill, sampled at pixel centres. */
export function fillPolygon(c: Canvas, pts: readonly Pt[], col: Rgb): void {
  if (pts.length < 3) return;
  const ys = pts.map((p) => p.y);
  const y0 = Math.max(0, Math.ceil(Math.min(...ys) - 0.5));
  const y1 = Math.min(c.height - 1, Math.floor(Math.max(...ys) - 0.5));
  for (let y = y0; y <= y1; y += 1) {
    const sy = y + 0.5;
    const xs: number[] = [];
    for (let i = 0; i < pts.length; i += 1) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      if ((a.y <= sy && b.y > sy) || (b.y <= sy && a.y > sy)) xs.push(a.x + ((sy - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k]! - 0.5));
      const xb = Math.min(c.width - 1, Math.floor(xs[k + 1]! - 0.5));
      for (let x = xa; x <= xb; x += 1) put(c, x, y, col, 1);
    }
  }
}

/** Axis-aligned ellipse; `shade(dy)` lets the caller darken the lower part (dy in -1..1). */
export function fillEllipse(c: Canvas, cx: number, cy: number, rx: number, ry: number, col: Rgb, shade?: (dx: number, dy: number) => number): void {
  const y0 = Math.max(0, Math.floor(cy - ry));
  const y1 = Math.min(c.height - 1, Math.ceil(cy + ry));
  const x0 = Math.max(0, Math.floor(cx - rx));
  const x1 = Math.min(c.width - 1, Math.ceil(cx + rx));
  for (let y = y0; y <= y1; y += 1)
    for (let x = x0; x <= x1; x += 1) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy > 1) continue;
      const k = shade ? shade(dx, dy) : 1;
      put(c, x, y, [col[0] * k, col[1] * k, col[2] * k], 1);
    }
}

/** 3x3 box blur, `passes` times (camera softness). */
export function blur(c: Canvas, passes: number): void {
  const { width: w, height: h } = c;
  const tmp = new Float32Array(c.rgb.length);
  for (let p = 0; p < passes; p += 1) {
    for (let y = 0; y < h; y += 1)
      for (let x = 0; x < w; x += 1)
        for (let ch = 0; ch < 3; ch += 1) {
          let s = 0;
          let n = 0;
          for (let dy = -1; dy <= 1; dy += 1) {
            const yy = y + dy;
            if (yy < 0 || yy >= h) continue;
            for (let dx = -1; dx <= 1; dx += 1) {
              const xx = x + dx;
              if (xx < 0 || xx >= w) continue;
              s += c.rgb[(yy * w + xx) * 3 + ch]!;
              n += 1;
            }
          }
          tmp[(y * w + x) * 3 + ch] = s / n;
        }
    c.rgb.set(tmp);
  }
}

/** Multiplies by gain(x, y), adds sensor noise (sigma, approx. Gaussian), quantises to RGBA. */
export function finish(c: Canvas, gain: (x: number, y: number) => number, sigma: number, rng: Rng): Uint8ClampedArray {
  const out = new Uint8ClampedArray(c.width * c.height * 4);
  const k = sigma * 2.449; // (u1 + u2 - 1) has sd 0.408; scale to the requested sigma
  for (let y = 0; y < c.height; y += 1)
    for (let x = 0; x < c.width; x += 1) {
      const g = gain(x, y);
      const i = y * c.width + x;
      for (let ch = 0; ch < 3; ch += 1) {
        const n = sigma > 0 ? (rng() + rng() - 1) * k : 0;
        out[i * 4 + ch] = c.rgb[i * 3 + ch]! * g + n;
      }
      out[i * 4 + 3] = 255;
    }
  return out;
}
