/**
 * Pure: frame an orthographic three-quarter camera on the room.
 * Works with plain numbers so it can be tested without a GPU.
 */
import type { Rect } from "./model";

export interface V3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface ViewAngles {
  /** Rotation of the camera around the room, radians. 0 = straight from +z (the front). */
  readonly azimuth: number;
  /** Angle above the floor, radians. */
  readonly elevation: number;
}

export interface Framing {
  /** Point the camera looks at. */
  readonly target: V3;
  /** Unit vector from the target toward the camera. */
  readonly dir: V3;
  /** Orthographic frustum half sizes in world units. */
  readonly halfW: number;
  readonly halfH: number;
}

/** A gentle three-quarter view from the front-right, a little above 45 degrees. */
export const DEFAULT_VIEW: ViewAngles = { azimuth: 0.42, elevation: 0.86 };

export function viewDir(v: ViewAngles): V3 {
  const c = Math.cos(v.elevation);
  return { x: Math.sin(v.azimuth) * c, y: Math.sin(v.elevation), z: Math.cos(v.azimuth) * c };
}

function cross(a: V3, b: V3): V3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function norm(a: V3): V3 {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
}
function dot(a: V3, b: V3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/** Camera right and up axes for a camera looking along -dir with world up +y. */
export function cameraAxes(dir: V3): { right: V3; up: V3 } {
  const forward = { x: -dir.x, y: -dir.y, z: -dir.z };
  const right = norm(cross(forward, { x: 0, y: 1, z: 0 }));
  const up = cross(right, forward);
  return { right, up };
}

export interface FrameOptions {
  readonly view?: ViewAngles;
  /** Fraction of the frame kept empty on each side. */
  readonly margin?: number;
  /** 1 = as framed; 2 = twice as close. */
  readonly zoom?: number;
  /** Where spare height goes when the points are wider than the view: "center" (default) or "bottom" (content sits on the bottom edge, slack above). */
  readonly alignV?: "center" | "bottom";
}

/**
 * Fit a set of world points into a viewport of the given aspect (width / height),
 * with margins on every side. The frame is centred on the points' screen extent.
 */
export function framePoints(points: readonly V3[], aspect: number, opts: FrameOptions = {}): Framing {
  const view = opts.view ?? DEFAULT_VIEW;
  const margin = opts.margin ?? 0.06;
  const zoom = opts.zoom ?? 1;
  const dir = viewDir(view);
  const { right, up } = cameraAxes(dir);
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  let sx = 0;
  let sy = 0;
  let sz = 0;
  for (const p of points) {
    const u = dot(p, right);
    const v = dot(p, up);
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
    sx += p.x;
    sy += p.y;
    sz += p.z;
  }
  if (points.length === 0) return { target: { x: 0, y: 0, z: 0 }, dir, halfW: 1, halfH: 1 };
  const usable = Math.max(0.1, 1 - 2 * margin);
  const safeAspect = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  let halfH = (maxV - minV) / 2 / usable;
  let halfW = halfH * safeAspect;
  if ((maxU - minU) / 2 / usable > halfW) {
    halfW = (maxU - minU) / 2 / usable;
    halfH = halfW / safeAspect;
  }
  // Start from the points' centroid and slide it in the screen plane to the extent centre.
  const base = { x: sx / points.length, y: sy / points.length, z: sz / points.length };
  const du = (minU + maxU) / 2 - dot(base, right);
  const centreV = opts.alignV === "bottom" ? minV + halfH * usable : (minV + maxV) / 2;
  const dv = centreV - dot(base, up);
  const target = {
    x: base.x + right.x * du + up.x * dv,
    y: base.y + right.y * du + up.y * dv,
    z: base.z + right.z * du + up.z * dv,
  };
  return { target, dir, halfW: halfW / zoom, halfH: halfH / zoom };
}

/**
 * World-space pan offset for a pointer drag of (dxPx, dyPx) CSS px, so the
 * content follows the pointer. `wpp` is world units per CSS px (2*halfW/width).
 */
export function panDelta(right: V3, up: V3, dxPx: number, dyPx: number, wpp: number): V3 {
  return {
    x: (up.x * dyPx - right.x * dxPx) * wpp,
    y: (up.y * dyPx - right.y * dxPx) * wpp,
    z: (up.z * dyPx - right.z * dxPx) * wpp,
  };
}

/**
 * Camera-target shift that keeps the world point under the cursor (cssX, cssY
 * inside the container) fixed when the scale changes from wppOld to wppNew.
 */
export function zoomAtDelta(right: V3, up: V3, cssX: number, cssY: number, width: number, height: number, wppOld: number, wppNew: number): V3 {
  const sx = cssX - width / 2;
  const sy = cssY - height / 2;
  const d = wppOld - wppNew;
  return {
    x: (right.x * sx - up.x * sy) * d,
    y: (right.y * sx - up.y * sy) * d,
    z: (right.z * sx - up.z * sy) * d,
  };
}

/** Cap the pan offset's length so the room can never be dragged out of frame. */
export function clampPan(pan: V3, limit: number): V3 {
  const l = Math.hypot(pan.x, pan.y, pan.z);
  if (l <= limit || l === 0) return pan;
  const s = limit / l;
  return { x: pan.x * s, y: pan.y * s, z: pan.z * s };
}

/** Corners of a floor rect from y = bottom to y = top. */
export function rectCorners(r: Rect, bottom: number, top: number): V3[] {
  const out: V3[] = [];
  for (const x of [r.minX, r.maxX]) for (const z of [r.minZ, r.maxZ]) for (const y of [bottom, top]) out.push({ x, y, z });
  return out;
}

/** Fit a floor rect and everything on it up to `height`. */
export function frameRoom(room: Rect, aspect: number, opts: FrameOptions & { readonly height?: number } = {}): Framing {
  return framePoints(rectCorners(room, 0, opts.height ?? 1.4), aspect, opts);
}
