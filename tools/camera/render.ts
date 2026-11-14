/**
 * Renders one synthetic camera frame: tiled floor, shaded prisms, people with
 * coloured hats, then blur, lighting change and sensor noise. Painter's
 * algorithm by object distance (fine for separated convex objects).
 */
import type { Frame } from "../../src/camera/frame";
import { applyHomography } from "../../src/camera/homography";
import { inv3, type Mat3 } from "../../src/camera/linalg";
import { cameraMatrix, depth, project, type CameraPose, type Mat34 } from "../../src/camera/pinhole";
import { mulberry32 } from "../../src/core/rng";
import type { Vec2, Vec3 } from "../../src/core/types";
import { blur, createCanvas, fillEllipse, fillPolygon, finish, type Canvas, type Rgb } from "./raster";
import type { Drawable, Person, Prism, StaticScene } from "./scene";

export interface RenderOptions {
  readonly t: number;
  readonly seed: number;
  readonly noiseSigma: number;
  readonly blurPasses: number;
  /** Slow brightness swing, as a fraction (0.15 = +-15 %). */
  readonly lightSwing: number;
  /** Overall exposure multiplier (1 = normal). */
  readonly exposure?: number;
}

export const DEFAULT_RENDER: Omit<RenderOptions, "t"> = { seed: 7, noiseSigma: 4, blurPasses: 1, lightSwing: 0.15 };

const LIGHT: Vec3 = (() => {
  const v = { x: -0.4, y: 1, z: 0.6 };
  const n = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / n, y: v.y / n, z: v.z / n };
})();

const shadeOf = (n: Vec3) => 0.55 + 0.45 * Math.max(0, n.x * LIGHT.x + n.y * LIGHT.y + n.z * LIGHT.z);
const scaled = (c: Rgb, k: number): Rgb => [c[0] * k, c[1] * k, c[2] * k];

function drawFloor(c: Canvas, p: Mat34, bounds: { minX: number; maxX: number; minZ: number; maxZ: number }) {
  const h: Mat3 = [p[0]!, p[2]!, p[3]!, p[4]!, p[6]!, p[7]!, p[8]!, p[10]!, p[11]!];
  const hinv = inv3(h);
  if (!hinv) return;
  for (let y = 0; y < c.height; y += 1)
    for (let x = 0; x < c.width; x += 1) {
      const i = (y * c.width + x) * 3;
      const f = applyHomography(hinv, { x: x + 0.5, y: y + 0.5 });
      const onFloor =
        f && depth(p, { x: f.x, y: 0, z: f.y }) > 0 && f.x > bounds.minX - 0.6 && f.x < bounds.maxX + 0.6 && f.y > bounds.minZ - 0.6 && f.y < bounds.maxZ + 0.8;
      if (!f || !onFloor) {
        c.rgb[i] = 120;
        c.rgb[i + 1] = 116;
        c.rgb[i + 2] = 110;
        continue;
      }
      const tx = Math.floor(f.x / 0.3);
      const tz = Math.floor(f.y / 0.3);
      const grout = Math.abs(f.x / 0.3 - Math.round(f.x / 0.3)) < 0.03 || Math.abs(f.y / 0.3 - Math.round(f.y / 0.3)) < 0.03;
      const tone = grout ? 0.82 : 0.97 + 0.03 * Math.sin(tx * 12.9898 + tz * 78.233);
      c.rgb[i] = 228 * tone;
      c.rgb[i + 1] = 218 * tone;
      c.rgb[i + 2] = 198 * tone;
    }
}

function drawPrism(c: Canvas, p: Mat34, cam: Vec3, pr: Prism) {
  const n = pr.base.length;
  const cx = pr.base.reduce((s, q) => s + q.x, 0) / n;
  const cz = pr.base.reduce((s, q) => s + q.z, 0) / n;
  const proj = (q: Vec2, y: number) => project(p, { x: q.x, y, z: q.z });
  for (let i = 0; i < n; i += 1) {
    const a = pr.base[i]!;
    const b = pr.base[(i + 1) % n]!;
    const mx = (a.x + b.x) / 2;
    const mz = (a.z + b.z) / 2;
    let nx = b.z - a.z;
    let nz = -(b.x - a.x);
    if (nx * (mx - cx) + nz * (mz - cz) < 0) [nx, nz] = [-nx, -nz];
    const len = Math.hypot(nx, nz);
    const facing = nx * (cam.x - mx) + nz * (cam.z - mz) > 0;
    if (!facing) continue;
    const quad = [proj(a, pr.y0), proj(b, pr.y0), proj(b, pr.y1), proj(a, pr.y1)];
    if (quad.every((q) => q)) fillPolygon(c, quad as { x: number; y: number }[], scaled(pr.color, shadeOf({ x: nx / len, y: 0, z: nz / len })));
  }
  if (cam.y > pr.y1) {
    const top = pr.base.map((q) => proj(q, pr.y1));
    if (top.every((q) => q)) fillPolygon(c, top as { x: number; y: number }[], scaled(pr.color, shadeOf({ x: 0, y: 1, z: 0 }) * 1.05));
  }
}

function drawPerson(c: Canvas, p: Mat34, cam: Vec3, who: Person, focal: number) {
  const ring = Array.from({ length: 8 }, (_, i) => ({
    x: who.p.x + 0.18 * Math.cos((i * Math.PI) / 4),
    z: who.p.z + 0.18 * Math.sin((i * Math.PI) / 4),
  }));
  drawPrism(c, p, cam, { kind: "prism", base: ring, y0: 0, y1: 1.42, color: who.shirt });
  const head = { x: who.p.x, y: who.hatY - 0.09, z: who.p.z };
  const hp = project(p, head);
  const hd = depth(p, head);
  if (hp && hd > 0) {
    const r = (focal * 0.1) / hd;
    fillEllipse(c, hp.x, hp.y, r, r * 1.05, [214, 168, 138], (dx) => 0.85 + 0.15 * (1 - dx));
  }
  const hat = { x: who.p.x, y: who.hatY, z: who.p.z };
  const tp = project(p, hat);
  const td = depth(p, hat);
  if (tp && td > 0) {
    const r = (focal * 0.11) / td;
    fillEllipse(c, tp.x, tp.y, r, r * 0.92, who.hat, (dx, dy) => 1.02 - 0.18 * Math.max(0, dy) - 0.08 * dx);
    if (who.armUp) {
      // A forearm across the hat: covers about a third of it.
      fillPolygon(c, [
        { x: tp.x - r * 1.4, y: tp.y - r * 0.15 },
        { x: tp.x + r * 1.4, y: tp.y - r * 0.55 },
        { x: tp.x + r * 1.4, y: tp.y + r * 0.1 },
        { x: tp.x - r * 1.4, y: tp.y + r * 0.5 },
      ], [205, 160, 130]);
    }
  }
}

function centroidOf(d: Drawable): Vec3 {
  if (d.kind === "person") return { x: d.p.x, y: 0.8, z: d.p.z };
  const n = d.base.length;
  return { x: d.base.reduce((s, q) => s + q.x, 0) / n, y: (d.y0 + d.y1) / 2, z: d.base.reduce((s, q) => s + q.z, 0) / n };
}

export function renderFrame(scene: StaticScene, people: readonly Person[], pose: CameraPose, o: RenderOptions): Frame {
  const p = cameraMatrix(pose);
  const cam = pose.position;
  const c = createCanvas(pose.width, pose.height);
  drawFloor(c, p, scene.view.bounds);
  const all: Drawable[] = [...scene.prisms, ...people];
  const dist = (d: Drawable) => {
    const q = centroidOf(d);
    return Math.hypot(q.x - cam.x, q.y - cam.y, q.z - cam.z);
  };
  const ordered = all.map((d) => ({ d, k: dist(d) })).sort((a, b) => b.k - a.k);
  for (const { d } of ordered) {
    if (d.kind === "person") drawPerson(c, p, cam, d, pose.focalPx);
    else drawPrism(c, p, cam, d);
  }
  if (o.blurPasses > 0) blur(c, o.blurPasses);
  const swing = (o.exposure ?? 1) * (1 + o.lightSwing * Math.sin((2 * Math.PI * o.t) / 37));
  const rng = mulberry32((o.seed * 100003 + Math.round(o.t * 1000)) >>> 0);
  // Window light from the left: the right side is up to 18 % darker.
  const data = finish(c, (x) => swing * (1.04 - (0.18 * x) / c.width), o.noiseSigma, rng);
  return { width: c.width, height: c.height, data };
}
