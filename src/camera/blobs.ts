/**
 * Hat blobs: threshold one colour, label connected regions, merge fragments.
 */
import { matches, type Hsv, type Thresholds } from "./color";
import type { HsvPlanes } from "./frame";

export interface Blob {
  readonly area: number;
  /** Centroid in working-frame pixels. */
  readonly cx: number;
  readonly cy: number;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** 1 where the pixel matches the target. */
export function colourMask(planes: HsvPlanes, target: Hsv, th: Thresholds): Uint8Array {
  const n = planes.width * planes.height;
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) if (matches(target, th, planes.h[i]!, planes.s[i]!, planes.v[i]!)) mask[i] = 1;
  return mask;
}

/** 8-connected regions of a mask (flood fill with an explicit stack). */
export function components(mask: Uint8Array, width: number, height: number): Blob[] {
  const seen = new Uint8Array(mask.length);
  const stack = new Int32Array(mask.length);
  const blobs: Blob[] = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (mask[start] === 0 || seen[start] === 1) continue;
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    let area = 0;
    let sx = 0;
    let sy = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    while (top > 0) {
      const i = stack[--top]!;
      const x = i % width;
      const y = (i - x) / width;
      area += 1;
      sx += x;
      sy += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy += 1) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const j = yy * width + xx;
          if (mask[j] === 1 && seen[j] === 0) {
            seen[j] = 1;
            stack[top++] = j;
          }
        }
      }
    }
    blobs.push({ area, cx: sx / area + 0.5, cy: sy / area + 0.5, minX, minY, maxX, maxY });
  }
  return blobs;
}

const radiusOf = (b: Blob) => Math.sqrt(b.area / Math.PI);

function mergeTwo(a: Blob, b: Blob): Blob {
  const area = a.area + b.area;
  return {
    area,
    cx: (a.cx * a.area + b.cx * b.area) / area,
    cy: (a.cy * a.area + b.cy * b.area) / area,
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

/**
 * Joins fragments of one hat (split by a hand, a shadow or a brim) when their
 * centres are closer than `factor` times the sum of their radii.
 */
export function mergeFragments(blobs: readonly Blob[], factor = 1.6): Blob[] {
  let out = [...blobs].sort((a, b) => b.area - a.area);
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < out.length; i += 1)
      for (let j = i + 1; j < out.length; j += 1) {
        const a = out[i]!;
        const b = out[j]!;
        if (Math.hypot(a.cx - b.cx, a.cy - b.cy) < factor * (radiusOf(a) + radiusOf(b))) {
          out = [...out.slice(0, i), mergeTwo(a, b), ...out.slice(i + 1, j), ...out.slice(j + 1)];
          changed = true;
          break outer;
        }
      }
  }
  return out.sort((a, b) => b.area - a.area);
}

export interface Detection {
  /** Candidates at least minArea, largest first. */
  readonly blobs: readonly Blob[];
  readonly mask: Uint8Array;
}

export function detectColour(planes: HsvPlanes, target: Hsv, th: Thresholds, minArea: number): Detection {
  const mask = colourMask(planes, target, th);
  const raw = components(mask, planes.width, planes.height).filter((b) => b.area >= Math.max(2, minArea / 4));
  const blobs = mergeFragments(raw).filter((b) => b.area >= minArea);
  return { blobs, mask };
}
