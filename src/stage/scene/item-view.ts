/**
 * One kitchen item as a painted toy block: rounded body at the scanned size,
 * a lighter lid, a cartoon outline, a bolted dark plinth when locked, an
 * optional topper, and a big invisible hit box for forgiving picking.
 */
import * as THREE from "three";
import { palette, roleColors } from "../theme/tokens";
import type { SceneItem } from "./model";
import { GeometryCache, disposeMaterials, mixInto, outlineMaterial, paint } from "./kit";
import { makeTopper } from "./toppers";
import { easeOutBack, followAlpha } from "./smoothing";

const HIT_PAD_M = 0.16;
const LIFT_M = 0.14;
const PLINTH_OUT_M = 0.07;
const PLINTH_H_M = 0.05;
const OUTLINE_M = 0.022;

let stripeTexture: THREE.CanvasTexture | null = null;
function queueStripes(): THREE.CanvasTexture {
  if (stripeTexture) return stripeTexture;
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d");
  if (ctx) {
    ctx.fillStyle = roleColors.queue.top;
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = roleColors.queue.body;
    ctx.lineWidth = 22;
    for (let i = -128; i < 256; i += 48) {
      ctx.beginPath();
      ctx.moveTo(i, 128);
      ctx.lineTo(i + 128, 0);
      ctx.stroke();
    }
  }
  stripeTexture = new THREE.CanvasTexture(c);
  stripeTexture.wrapS = THREE.RepeatWrapping;
  stripeTexture.wrapT = THREE.RepeatWrapping;
  stripeTexture.colorSpace = THREE.SRGBColorSpace;
  return stripeTexture;
}

function buildKey(it: SceneItem): string {
  return [it.size.w, it.size.h, it.size.d, it.role, it.locked, it.name, it.category].join("|");
}

export class ItemView {
  readonly root = new THREE.Group();
  /** Carries lift, shake and the reveal pop. */
  private readonly lift = new THREE.Group();
  readonly hit: THREE.Mesh;
  private body!: THREE.Mesh;
  private lid: THREE.Mesh | null = null;
  private outline!: THREE.Mesh;
  private topper: THREE.Object3D | null = null;
  private plinth: THREE.Object3D | null = null;
  private bodyMat!: THREE.MeshStandardMaterial;
  private lidMat: THREE.MeshStandardMaterial | null = null;
  private outlineMat!: THREE.MeshBasicMaterial;
  private halo: THREE.Mesh | null = null;
  private haloMat: THREE.MeshBasicMaterial | null = null;
  private key = "";

  item: SceneItem;
  /** 0 = raw scan paint, 1 = owner's role paint. */
  paintMix = 1;
  /** 0 = not yet revealed (flat), 1 = standing. */
  appear = 1;
  private appearFrom = 0;
  private appearStart = -1;
  private appearDur = 0.55;
  liftTarget = 0;
  private liftNow = 0;
  private shakeStart = -1;
  pulse = 0;
  selected = false;
  hovered = false;

  constructor(item: SceneItem, private readonly geo: GeometryCache) {
    this.item = item;
    this.hit = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ visible: false }));
    this.hit.userData.boxId = item.id;
    this.root.add(this.lift, this.hit);
    this.sync(item);
  }

  sync(item: SceneItem): void {
    this.item = item;
    const key = buildKey(item);
    if (key !== this.key) {
      this.key = key;
      this.rebuild();
    }
    this.root.position.set(item.x, 0, item.z);
    this.root.rotation.y = item.yaw;
  }

  private rebuild(): void {
    const it = this.item;
    disposeMaterials(this.lift);
    this.lift.clear();
    const { w, h, d } = it.size;
    const isMark = it.role === "queue" || h < 0.06;
    const bodyH = isMark ? 0.03 : h;
    const role = roleColors[it.role];
    this.bodyMat = isMark ? paint("#ffffff", { map: queueStripes(), transparent: true, opacity: 0.95 }) : paint(role.body);
    if (isMark) {
      const t = this.bodyMat.map;
      if (t) t.repeat.set(Math.max(1, w * 3), Math.max(1, d * 3));
    }
    this.body = new THREE.Mesh(this.geo.roundedBox(w, bodyH, d, isMark ? 0.012 : 0.06), this.bodyMat);
    this.body.position.y = bodyH / 2;
    this.body.castShadow = !isMark;
    this.body.receiveShadow = true;
    this.outlineMat = outlineMaterial(palette.ink, 0.9);
    this.outline = new THREE.Mesh(this.geo.roundedBox(w + OUTLINE_M * 2, bodyH + OUTLINE_M * 2, d + OUTLINE_M * 2, isMark ? 0.02 : 0.07), this.outlineMat);
    this.outline.position.y = bodyH / 2;
    this.lift.add(this.body, this.outline);

    this.lid = null;
    this.lidMat = null;
    if (!isMark) {
      this.lidMat = paint(role.top);
      this.lid = new THREE.Mesh(this.geo.roundedBox(Math.max(0.05, w - 0.08), 0.03, Math.max(0.05, d - 0.08), 0.012), this.lidMat);
      this.lid.position.y = h + 0.005;
      this.lid.receiveShadow = true;
      this.lift.add(this.lid);
    }
    this.plinth = it.locked && !isMark ? this.makePlinth(w, d) : null;
    if (this.plinth) this.lift.add(this.plinth);
    // Bottleneck halo: a tomato rim on the floor around the base, shown while the pile is large.
    this.haloMat = new THREE.MeshBasicMaterial({ color: palette.alert, transparent: true, opacity: 0, depthWrite: false });
    this.halo = new THREE.Mesh(this.geo.roundedBox(w + 0.34, 0.012, d + 0.34, 0.006), this.haloMat);
    this.halo.position.y = 0.007;
    this.halo.visible = false;
    this.lift.add(this.halo);
    this.topper = makeTopper(it, this.geo);
    if (this.topper) {
      this.topper.traverse((o) => {
        o.castShadow = true;
      });
      this.lift.add(this.topper);
    }
    const hh = Math.max(bodyH, 0.45);
    this.hit.scale.set(w + HIT_PAD_M * 2, hh + HIT_PAD_M, d + HIT_PAD_M * 2);
    this.hit.position.y = hh / 2;
    this.applyPaint();
  }

  private makePlinth(w: number, d: number): THREE.Group {
    const g = new THREE.Group();
    const plate = new THREE.Mesh(
      this.geo.roundedBox(w + PLINTH_OUT_M * 2, PLINTH_H_M, d + PLINTH_OUT_M * 2, 0.02),
      paint(palette.bolt, { roughness: 0.6 }),
    );
    plate.position.y = PLINTH_H_M / 2;
    plate.receiveShadow = true;
    g.add(plate);
    const boltGeo = this.geo.get("bolt", () => new THREE.CylinderGeometry(0.03, 0.03, 0.035, 6));
    const boltMat = paint("#d8d2c8", { metalness: 0.5, roughness: 0.35 });
    const bx = w / 2 + PLINTH_OUT_M / 2;
    const bz = d / 2 + PLINTH_OUT_M / 2;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      const b = new THREE.Mesh(boltGeo, boltMat);
      b.position.set(sx * bx, PLINTH_H_M + 0.012, sz * bz);
      g.add(b);
    }
    return g;
  }

  /**
   * Where the name tag hangs: above the back edge of the top, so the front of
   * the top (piles, toppers) stays visible below it.
   */
  labelAnchor(out: THREE.Vector3): THREE.Vector3 {
    if (this.item.role === "queue") return out.set(0, 0.05, 0).applyMatrix4(this.root.matrixWorld);
    const { h, d } = this.item.size;
    return out.set(0, h + 0.08 + this.liftNow, -d / 2 + 0.04).applyMatrix4(this.root.matrixWorld);
  }

  /** Where the ticket pile sits, in the item's local frame: front-right of the top, nearest the audience. */
  pileLocal(out: THREE.Vector3): THREE.Vector3 {
    const { w, h, d } = this.item.size;
    const top = this.item.role === "queue" ? 0.03 : h + 0.03;
    return out.set(w / 2 - Math.min(0.21, w * 0.27), top + this.liftNow, d / 2 - Math.min(0.17, d * 0.3));
  }

  startAppear(now: number, delay: number, from = 0): void {
    this.appearFrom = from;
    this.appear = from;
    this.appearStart = now + delay;
    this.applyAppear();
  }

  shake(now: number): void {
    this.shakeStart = now;
  }

  private applyAppear(): void {
    const s = Math.max(0.001, this.appear);
    this.lift.scale.set(0.6 + 0.4 * Math.min(1, s), s, 0.6 + 0.4 * Math.min(1, s));
    this.lift.visible = this.appear > 0.002;
  }

  applyPaint(): void {
    const it = this.item;
    const role = roleColors[it.role];
    const t = this.paintMix;
    const isMark = it.role === "queue" || it.size.h < 0.06;
    if (!isMark) mixInto(this.bodyMat.color, palette.scanBox, role.body, t);
    else this.bodyMat.opacity = 0.35 + 0.6 * t;
    if (this.lidMat) mixInto(this.lidMat.color, "#eef3f4", role.top, t);
    if (this.halo && this.haloMat) {
      this.halo.visible = this.pulse > 0;
      this.haloMat.opacity = 0.45 + 0.5 * this.pulse;
    }
    if (this.selected) mixInto(this.outlineMat.color, palette.select, palette.select, 1);
    else if (this.pulse > 0) this.outlineMat.color.set(palette.alert);
    else if (t < 1) mixInto(this.outlineMat.color, palette.scan, palette.ink, t);
    else this.outlineMat.color.set(palette.ink);
    this.outline.scale.setScalar(this.selected ? 1.035 : this.hovered ? 1.02 : 1);
    // Toppers and bolts come from the owner's naming, so they appear with the names.
    if (this.topper) this.topper.visible = t > 0.5;
    if (this.plinth) this.plinth.visible = t > 0.5;
    const ignoreHidden = it.role === "ignore" ? 1 - t : 1;
    this.root.visible = ignoreHidden > 0.01;
    this.hit.visible = it.role !== "ignore";
    if (it.role === "ignore") this.root.scale.setScalar(Math.max(0.01, ignoreHidden));
    else this.root.scale.setScalar(1);
  }

  /** Advance animations. Returns true while something is still moving. */
  tick(now: number, dt: number): boolean {
    let busy = false;
    if (this.appearStart >= 0) {
      const p = (now - this.appearStart) / this.appearDur;
      if (p >= 1) {
        this.appear = 1;
        this.appearStart = -1;
      } else if (p >= 0) {
        this.appear = this.appearFrom + (1 - this.appearFrom) * easeOutBack(p, 2.2);
      }
      this.applyAppear();
      busy = true;
    }
    const prevLift = this.liftNow;
    this.liftNow += (this.liftTarget * LIFT_M - this.liftNow) * followAlpha(dt, 0.07);
    if (Math.abs(this.liftNow - this.liftTarget * LIFT_M) < 1e-4) this.liftNow = this.liftTarget * LIFT_M;
    if (this.liftNow !== prevLift) busy = true;
    let shakeX = 0;
    if (this.shakeStart >= 0) {
      const p = (now - this.shakeStart) / 0.45;
      if (p >= 1) this.shakeStart = -1;
      else {
        shakeX = Math.sin(p * Math.PI * 7) * 0.06 * (1 - p);
        busy = true;
      }
    }
    this.lift.position.set(shakeX, this.liftNow, 0);
    return busy;
  }

  dispose(): void {
    disposeMaterials(this.lift);
    (this.hit.material as THREE.Material).dispose();
    this.hit.geometry.dispose();
  }
}
