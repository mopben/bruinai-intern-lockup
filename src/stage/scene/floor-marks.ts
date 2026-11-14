/**
 * Things drawn flat on the floor: dashed walking paths and ghost outlines of
 * where items used to be. Dashes are instanced so a live drag costs one
 * matrix upload per path colour.
 */
import * as THREE from "three";
import { palette, pathColors } from "../theme/tokens";
import type { PathInput } from "./api";
import { GeometryCache } from "./kit";
import type { SceneItem } from "./model";

const DASH_M = 0.16;
const GAP_M = 0.1;
const MAX_DASHES = 800;
const PATH_Y = 0.012;

/** Pure: dash centres and headings along a polyline. Exported for tests. */
export function dashLayout(points: readonly { x: number; z: number }[], dash = DASH_M, gap = GAP_M): { x: number; z: number; yaw: number }[] {
  const out: { x: number; z: number; yaw: number }[] = [];
  let carry = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (!a || !b) continue;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 1e-6) continue;
    const ux = (b.x - a.x) / len;
    const uz = (b.z - a.z) / len;
    const yaw = Math.atan2(ux, uz);
    let s = carry;
    while (s + dash / 2 <= len) {
      const c = s + dash / 2;
      out.push({ x: a.x + ux * c, z: a.z + uz * c, yaw });
      s += dash + gap;
    }
    carry = s - len;
  }
  return out;
}

/** Pure: point at half the length of a polyline. */
export function polylineMidpoint(points: readonly { x: number; z: number }[]): { x: number; z: number } | null {
  if (points.length === 0) return null;
  let total = 0;
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.z - points[i - 1]!.z);
  let half = total / 2;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const l = Math.hypot(b.x - a.x, b.z - a.z);
    if (half <= l && l > 0) return { x: a.x + ((b.x - a.x) * half) / l, z: a.z + ((b.z - a.z) * half) / l };
    half -= l;
  }
  return points[points.length - 1] ?? null;
}

export class PathLayer {
  readonly group = new THREE.Group();
  private readonly meshes = new Map<string, THREE.InstancedMesh>();
  private readonly dummy = new THREE.Object3D();
  midpoints: ({ x: number; z: number } | null)[] = [];
  labels: string[] = [];

  constructor(private readonly geo: GeometryCache) {}

  private meshFor(color: string): THREE.InstancedMesh {
    const hit = this.meshes.get(color);
    if (hit) return hit;
    const m = new THREE.InstancedMesh(
      this.geo.roundedBox(0.07, 0.012, DASH_M, 0.005),
      new THREE.MeshStandardMaterial({ color, roughness: 0.7 }),
      MAX_DASHES,
    );
    m.count = 0;
    m.receiveShadow = true;
    this.meshes.set(color, m);
    this.group.add(m);
    return m;
  }

  set(paths: readonly PathInput[]): void {
    const counts = new Map<string, number>();
    for (const m of this.meshes.values()) m.count = 0;
    for (const p of paths) {
      const color = pathColors[p.kind ?? "walk"] ?? palette.path;
      const mesh = this.meshFor(color);
      let n = counts.get(color) ?? 0;
      for (const d of dashLayout(p.points)) {
        if (n >= MAX_DASHES) break;
        this.dummy.position.set(d.x, PATH_Y, d.z);
        this.dummy.rotation.set(0, d.yaw, 0);
        this.dummy.updateMatrix();
        mesh.setMatrixAt(n++, this.dummy.matrix);
      }
      counts.set(color, n);
    }
    for (const [color, m] of this.meshes) {
      m.count = counts.get(color) ?? 0;
      m.instanceMatrix.needsUpdate = true;
    }
    this.midpoints = paths.map((p) => (p.label ? polylineMidpoint(p.points) : null));
    this.labels = paths.map((p) => p.label ?? "");
  }

  dispose(): void {
    for (const m of this.meshes.values()) {
      (m.material as THREE.Material).dispose();
      m.dispose();
    }
  }
}

/** Faint outline + footprint where items stood in the ghost layout. */
export class GhostLayer {
  readonly group = new THREE.Group();
  private readonly fill = new THREE.MeshBasicMaterial({ color: palette.ink, transparent: true, opacity: 0.08, depthWrite: false });
  private readonly line = new THREE.MeshBasicMaterial({ color: palette.inkSoft, transparent: true, opacity: 0.55, depthWrite: false });
  private readonly shell = new THREE.MeshBasicMaterial({ color: palette.paper, transparent: true, opacity: 0.18, depthWrite: false });
  private key = "";

  set(entries: readonly { item: SceneItem; x: number; z: number; yaw: number }[]): void {
    const key = JSON.stringify(entries.map((e) => [e.item.id, e.x, e.z, e.yaw, e.item.size]));
    if (key === this.key) return;
    this.key = key;
    this.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose?.());
    this.group.clear();
    for (const e of entries) {
      const { w, h, d } = e.item.size;
      const g = new THREE.Group();
      g.position.set(e.x, 0, e.z);
      g.rotation.y = e.yaw;
      const frame = new THREE.Shape();
      const t = 0.035;
      roundRect(frame, -w / 2 - t, -d / 2 - t, w + 2 * t, d + 2 * t, 0.07);
      const hole = new THREE.Path();
      roundRect(hole, -w / 2, -d / 2, w, d, 0.05);
      frame.holes.push(hole);
      const ring = new THREE.Mesh(new THREE.ShapeGeometry(frame, 6).rotateX(-Math.PI / 2), this.line);
      ring.position.y = 0.01;
      const pad = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), this.fill);
      pad.position.y = 0.008;
      const shell = new THREE.Mesh(new THREE.BoxGeometry(w, Math.max(0.03, h), d), this.shell);
      shell.position.y = Math.max(0.03, h) / 2;
      g.add(pad, ring, shell);
      this.group.add(g);
    }
  }

  dispose(): void {
    this.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose?.());
    this.fill.dispose();
    this.line.dispose();
    this.shell.dispose();
  }
}

function roundRect(p: THREE.Path, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  p.moveTo(x + rr, y);
  p.lineTo(x + w - rr, y);
  p.quadraticCurveTo(x + w, y, x + w, y + rr);
  p.lineTo(x + w, y + h - rr);
  p.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  p.lineTo(x + rr, y + h);
  p.quadraticCurveTo(x, y + h, x, y + h - rr);
  p.lineTo(x, y + rr);
  p.quadraticCurveTo(x, y, x + rr, y);
}
