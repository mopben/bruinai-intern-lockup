/**
 * Workers as chunky toy pawns with a coloured cap (the cap's visor shows
 * which way they face) and a coloured disc on the floor so a pawn reads as a
 * dot from the back of the room. Positions are smoothed between updates.
 */
import * as THREE from "three";
import { palette } from "../theme/tokens";
import type { WorkerInput } from "./api";
import { GeometryCache, outlineMaterial, paint } from "./kit";
import { bobHeight, easeOutBack, stepPawn, type PawnState } from "./smoothing";

const PAWN_SCALE = 1.25;
const POP_S = 0.5;

interface Pawn {
  readonly group: THREE.Group;
  readonly figure: THREE.Group;
  readonly cup: THREE.Mesh;
  readonly hatMat: THREE.MeshStandardMaterial;
  readonly discMat: THREE.MeshBasicMaterial;
  readonly rimMat: THREE.MeshBasicMaterial;
  color: string;
  state: PawnState;
  tx: number;
  tz: number;
  bornAt: number;
  leavingAt: number;
}

/** Pawn-owned materials only; body, skin, cup and outline are shared. */
function disposePawn(p: Pawn): void {
  p.hatMat.dispose();
  p.discMat.dispose();
  p.rimMat.dispose();
}

export class Pawns {
  readonly group = new THREE.Group();
  private readonly pawns = new Map<string, Pawn>();
  private readonly bodyMat = paint("#fbf3e4");
  private readonly skinMat = paint("#efc7a0");
  private readonly cupMat = paint(palette.paper);
  private readonly hullMat = outlineMaterial(palette.ink, 0.9);

  constructor(private readonly geo: GeometryCache) {}

  private make(w: WorkerInput, now: number): Pawn {
    const g = this.geo;
    const group = new THREE.Group();
    const figure = new THREE.Group();
    const hatMat = paint(w.color, { roughness: 0.6 });
    const discMat = new THREE.MeshBasicMaterial({ color: w.color, transparent: true, opacity: 0.85, depthWrite: false });

    const disc = new THREE.Mesh(g.get("pawn-disc", () => new THREE.CircleGeometry(0.27, 32).rotateX(-Math.PI / 2)), discMat);
    disc.position.y = 0.006;
    disc.renderOrder = 1;
    const rimMat = new THREE.MeshBasicMaterial({ color: palette.ink, transparent: true, opacity: 0.6, depthWrite: false });
    const discRim = new THREE.Mesh(g.get("pawn-rim", () => new THREE.RingGeometry(0.27, 0.3, 32).rotateX(-Math.PI / 2)), rimMat);
    discRim.position.y = 0.007;

    const body = new THREE.Mesh(g.get("pawn-body", () => new THREE.CylinderGeometry(0.1, 0.17, 0.42, 24)), this.bodyMat);
    body.position.y = 0.21;
    const bodyHull = new THREE.Mesh(g.get("pawn-body-hull", () => new THREE.CylinderGeometry(0.115, 0.185, 0.44, 24)), this.hullMat);
    bodyHull.position.y = 0.21;
    const head = new THREE.Mesh(g.get("pawn-head", () => new THREE.SphereGeometry(0.13, 24, 16)), this.skinMat);
    head.position.y = 0.55;
    const headHull = new THREE.Mesh(g.get("pawn-head-hull", () => new THREE.SphereGeometry(0.145, 24, 16)), this.hullMat);
    headHull.position.y = 0.55;
    const cap = new THREE.Mesh(g.get("pawn-cap", () => new THREE.SphereGeometry(0.15, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2)), hatMat);
    cap.position.y = 0.58;
    const visor = new THREE.Mesh(g.roundedBox(0.2, 0.03, 0.14, 0.012), hatMat);
    visor.position.set(0, 0.6, 0.15);
    const pom = new THREE.Mesh(g.get("pawn-pom", () => new THREE.SphereGeometry(0.035, 12, 8)), hatMat);
    pom.position.y = 0.735;
    const cup = new THREE.Mesh(g.get("pawn-cup", () => new THREE.CylinderGeometry(0.06, 0.045, 0.11, 16)), this.cupMat);
    cup.position.set(0, 0.34, 0.2);
    cup.visible = false;
    for (const m of [body, head, cap, visor, cup]) m.castShadow = true;
    figure.add(body, bodyHull, head, headHull, cap, visor, pom, cup);
    figure.scale.setScalar(0.001);
    group.add(disc, discRim, figure);
    group.scale.setScalar(PAWN_SCALE);
    group.position.set(w.x, 0, w.z);
    this.group.add(group);
    return {
      group,
      figure,
      cup,
      hatMat,
      discMat,
      rimMat,
      color: w.color,
      state: { x: w.x, z: w.z, yaw: 0, speed: 0, phase: 0 },
      tx: w.x,
      tz: w.z,
      bornAt: now,
      leavingAt: -1,
    };
  }

  set(workers: readonly WorkerInput[], now: number): void {
    const seen = new Set<string>();
    for (const w of workers) {
      seen.add(w.id);
      let p = this.pawns.get(w.id);
      if (!p) {
        p = this.make(w, now);
        this.pawns.set(w.id, p);
      }
      if (p.leavingAt >= 0) {
        p.leavingAt = -1;
        p.bornAt = now;
      }
      if (p.color !== w.color) {
        p.color = w.color;
        p.hatMat.color.set(w.color);
        p.discMat.color.set(w.color);
      }
      p.tx = w.x;
      p.tz = w.z;
      p.cup.visible = !!w.carrying;
    }
    for (const [id, p] of this.pawns) {
      if (!seen.has(id) && p.leavingAt < 0) p.leavingAt = now;
    }
  }

  /** World positions of every pawn's cap, written into `out` (reused). */
  heads(out: THREE.Vector3[]): number {
    let i = 0;
    for (const p of this.pawns.values()) {
      if (p.leavingAt >= 0) continue;
      const v = out[i] ?? (out[i] = new THREE.Vector3());
      v.set(p.state.x, 0.62 * PAWN_SCALE, p.state.z);
      i++;
    }
    return i;
  }

  /** Returns true while any pawn is still moving or popping. */
  tick(now: number, dt: number): boolean {
    let busy = false;
    for (const [id, p] of this.pawns) {
      p.state = stepPawn(p.state, p.tx, p.tz, dt);
      const moving = Math.hypot(p.tx - p.state.x, p.tz - p.state.z) > 0.002 || p.state.speed > 0.01;
      const bob = bobHeight(p.state);
      p.group.position.set(p.state.x, 0, p.state.z);
      p.figure.position.y = bob;
      p.figure.rotation.y = p.state.yaw;
      p.figure.rotation.z = Math.sin(p.state.phase) * 0.06 * Math.min(1, p.state.speed);
      const age = (now - p.bornAt) / POP_S;
      let s = age >= 1 ? 1 : Math.max(0.001, easeOutBack(age, 2.4));
      if (p.leavingAt >= 0) {
        const out = (now - p.leavingAt) / 0.3;
        if (out >= 1) {
          this.group.remove(p.group);
          disposePawn(p);
          this.pawns.delete(id);
          busy = true;
          continue;
        }
        s = Math.max(0.001, 1 - out);
      }
      p.figure.scale.setScalar(s);
      if (moving || age < 1 || p.leavingAt >= 0) busy = true;
    }
    return busy;
  }

  dispose(): void {
    for (const p of this.pawns.values()) disposePawn(p);
    this.pawns.clear();
    for (const m of [this.bodyMat, this.skinMat, this.cupMat, this.hullMat]) m.dispose();
  }
}
