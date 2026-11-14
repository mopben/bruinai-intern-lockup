/**
 * RGBA frames and their hue/saturation/value planes. Pixel buffers are the
 * one place we mutate in place (allocating per pixel would be far too slow).
 */
import { rgbToHsv } from "./color";

export interface Frame {
  readonly width: number;
  readonly height: number;
  /** RGBA, row-major, 4 bytes per pixel. */
  readonly data: Uint8ClampedArray | Uint8Array;
}

export interface HsvPlanes {
  readonly width: number;
  readonly height: number;
  readonly h: Float32Array;
  readonly s: Float32Array;
  readonly v: Float32Array;
}

export function toHsvPlanes(frame: Frame): HsvPlanes {
  const n = frame.width * frame.height;
  const h = new Float32Array(n);
  const s = new Float32Array(n);
  const v = new Float32Array(n);
  const d = frame.data;
  for (let i = 0; i < n; i += 1) {
    const c = rgbToHsv(d[i * 4]!, d[i * 4 + 1]!, d[i * 4 + 2]!);
    h[i] = c.h;
    s[i] = c.s;
    v[i] = c.v;
  }
  return { width: frame.width, height: frame.height, h, s, v };
}

/** Box-filter downscale to the given width (height keeps the aspect). */
export function downscale(frame: Frame, width: number): Frame {
  if (width >= frame.width) return frame;
  const k = frame.width / width;
  const height = Math.max(1, Math.round(frame.height / k));
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.floor(y * k);
    const y1 = Math.min(frame.height, Math.max(y0 + 1, Math.floor((y + 1) * k)));
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.floor(x * k);
      const x1 = Math.min(frame.width, Math.max(x0 + 1, Math.floor((x + 1) * k)));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let yy = y0; yy < y1; yy += 1)
        for (let xx = x0; xx < x1; xx += 1) {
          const i = (yy * frame.width + xx) * 4;
          r += frame.data[i]!;
          g += frame.data[i + 1]!;
          b += frame.data[i + 2]!;
          a += frame.data[i + 3]!;
        }
      const cnt = (y1 - y0) * (x1 - x0);
      const o = (y * width + x) * 4;
      out[o] = r / cnt;
      out[o + 1] = g / cnt;
      out[o + 2] = b / cnt;
      out[o + 3] = a / cnt;
    }
  }
  return { width, height, data: out };
}

/** HSV of the pixels in a square around (x, y), clipped to the frame. */
export function samplePatch(planes: HsvPlanes, x: number, y: number, radius: number) {
  const out: { h: number; s: number; v: number }[] = [];
  for (let yy = Math.max(0, Math.round(y) - radius); yy <= Math.min(planes.height - 1, Math.round(y) + radius); yy += 1)
    for (let xx = Math.max(0, Math.round(x) - radius); xx <= Math.min(planes.width - 1, Math.round(x) + radius); xx += 1) {
      const i = yy * planes.width + xx;
      out.push({ h: planes.h[i]!, s: planes.s[i]!, v: planes.v[i]! });
    }
  return out;
}
