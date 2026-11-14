/**
 * Order tickets stacking on each station. A growing pile is the loudest thing
 * on screen: tickets drop in with a bounce, the pile turns tomato and the
 * station glows once it reaches the alert size. Removed tickets fly up and fade.
 */
import * as THREE from "three";
import { palette } from "../theme/tokens";
import { GeometryCache, paint } from "./kit";
import { easeOutCubic } from "./smoothing";

/** Tickets drawn per pile; the badge shows the real count beyond this. */
export const MAX_VISIBLE_TICKETS = 14;
const TICKET_H = 0.07;
const DROP_S = 0.38;
const LEAVE_S = 0.35;

interface Ticket {
  readonly mesh: THREE.Mesh;
  readonly index: number;
  bornAt: number;
  leavingAt: number;
}

/** Deterministic small wobble so piles look hand-stacked but never flicker. */
function wobble(i: number): { dx: number; dz: number; rot: number } {
  const a = Math.sin(i * 12.9898) * 43758.5453;
  const b = Math.sin(i * 78.233) * 12345.6789;
  const fa = a - Math.floor(a) - 0.5;
  const fb = b - Math.floor(b) - 0.5;
  return { dx: fa * 0.03, dz: fb * 0.03, rot: fa * 0.5 };
}

export class TicketPile {
  readonly group = new THREE.Group();
  private tickets: Ticket[] = [];
  count = 0;
  alert = false;

  constructor(
    private readonly geo: GeometryCache,
    private readonly paperMat: THREE.Material,
    private readonly alertMat: THREE.Material,
  ) {}

  setCount(n: number, alertAt: number, now: number): void {
    const count = Math.max(0, Math.floor(n));
    this.count = count;
    this.alert = count >= alertAt;
    const visible = Math.min(MAX_VISIBLE_TICKETS, count);
    const live = this.tickets.filter((t) => t.leavingAt < 0);
    for (let i = live.length; i < visible; i++) {
      const w = wobble(i);
      const mesh = new THREE.Mesh(this.geo.roundedBox(0.3, TICKET_H - 0.01, 0.24, 0.018), this.paperMat);
      mesh.castShadow = true;
      mesh.position.set(w.dx, i * TICKET_H + TICKET_H / 2, w.dz);
      mesh.rotation.y = w.rot;
      this.group.add(mesh);
      this.tickets.push({ mesh, index: i, bornAt: now + (i - live.length) * 0.06, leavingAt: -1 });
    }
    for (let i = live.length - 1; i >= visible; i--) {
      const t = live[i];
      if (t) t.leavingAt = now;
    }
    for (const t of this.tickets) if (t.leavingAt < 0) t.mesh.material = this.alert ? this.alertMat : this.paperMat;
  }

  /** Height of the pile top above its anchor, metres. */
  get height(): number {
    return Math.min(MAX_VISIBLE_TICKETS, this.count) * TICKET_H;
  }

  tick(now: number): boolean {
    let busy = false;
    const keep: Ticket[] = [];
    for (const t of this.tickets) {
      const restY = t.index * TICKET_H + TICKET_H / 2;
      if (t.leavingAt >= 0) {
        const p = (now - t.leavingAt) / LEAVE_S;
        if (p >= 1) {
          this.group.remove(t.mesh);
          busy = true;
          continue;
        }
        t.mesh.position.y = restY + easeOutCubic(p) * 0.5;
        t.mesh.scale.setScalar(Math.max(0.001, 1 - p));
        busy = true;
      } else {
        const p = (now - t.bornAt) / DROP_S;
        if (p < 0) {
          t.mesh.visible = false;
          busy = true;
        } else if (p < 1) {
          t.mesh.visible = true;
          // Fall from above, land, small squash.
          const fall = 1 - easeOutCubic(Math.min(1, p * 1.6));
          t.mesh.position.y = restY + fall * 0.45;
          const squash = p > 0.6 ? Math.sin(((p - 0.6) / 0.4) * Math.PI) * 0.25 : 0;
          t.mesh.scale.set(1 + squash * 0.4, 1 - squash, 1 + squash * 0.4);
          busy = true;
        } else {
          t.mesh.visible = true;
          t.mesh.position.y = restY;
          t.mesh.scale.setScalar(1);
        }
      }
      keep.push(t);
    }
    this.tickets = keep;
    return busy;
  }
}

export function ticketMaterials(): { paper: THREE.MeshStandardMaterial; alert: THREE.MeshStandardMaterial } {
  return {
    paper: paint(palette.ticket, { roughness: 0.9 }),
    alert: paint("#ff7b62", { roughness: 0.85, emissive: palette.alert, emissiveIntensity: 0.25 }),
  };
}
