/**
 * The diorama board: a birch-ply slab with a cream tiled floor (1 m lines and
 * a "1 m" scale bar) and the scanned walls drawn low so they never hide the action.
 */
import * as THREE from "three";
import { fonts, palette } from "../theme/tokens";
import type { Rect, SceneWall } from "./model";
import { GeometryCache, disposeMaterials, outlineMaterial, paint } from "./kit";

export const BOARD_PAD_M = 0.22;
export const BOARD_THICK_M = 0.16;
/** Walls are cut away to this height, metres. */
export const WALL_HEIGHT_M = 0.34;
const PX_PER_M = 160;

function drawFloor(canvas: HTMLCanvasElement, room: Rect, pad: number): void {
  const w = room.maxX - room.minX + 2 * pad;
  const d = room.maxZ - room.minZ + 2 * pad;
  canvas.width = Math.ceil(w * PX_PER_M);
  canvas.height = Math.ceil(d * PX_PER_M);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const ox = (room.minX - pad) * -1;
  const oz = (room.minZ - pad) * -1;
  const toPx = (m: number) => m * PX_PER_M;
  ctx.fillStyle = palette.floor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Half-metre tiles in two creams, 1 m lines on top.
  const startX = Math.floor(room.minX - pad);
  const startZ = Math.floor(room.minZ - pad);
  for (let x = startX; x < room.maxX + pad; x += 0.5) {
    for (let z = startZ; z < room.maxZ + pad; z += 0.5) {
      const ix = Math.round(x * 2);
      const iz = Math.round(z * 2);
      if ((ix + iz) % 2 === 0) continue;
      ctx.fillStyle = "rgba(214,181,131,0.10)";
      ctx.fillRect(toPx(x + ox), toPx(z + oz), toPx(0.5), toPx(0.5));
    }
  }
  ctx.strokeStyle = palette.floorLine;
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let x = Math.ceil(room.minX - pad); x <= room.maxX + pad; x += 1) {
    ctx.moveTo(toPx(x + ox), 0);
    ctx.lineTo(toPx(x + ox), canvas.height);
  }
  for (let z = Math.ceil(room.minZ - pad); z <= room.maxZ + pad; z += 1) {
    ctx.moveTo(0, toPx(z + oz));
    ctx.lineTo(canvas.width, toPx(z + oz));
  }
  ctx.stroke();

  // Scale bar near the front-left corner.
  const bx = toPx(room.minX + ox + 0.35);
  const bz = toPx(room.maxZ + oz + pad * 0.55);
  ctx.strokeStyle = palette.inkSoft;
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(bx, bz);
  ctx.lineTo(bx + PX_PER_M, bz);
  ctx.moveTo(bx, bz - 12);
  ctx.lineTo(bx, bz + 12);
  ctx.moveTo(bx + PX_PER_M, bz - 12);
  ctx.lineTo(bx + PX_PER_M, bz + 12);
  ctx.stroke();
  ctx.fillStyle = palette.inkSoft;
  ctx.font = `700 34px ${fonts.display}`;
  ctx.textBaseline = "middle";
  ctx.fillText("1 m", bx + PX_PER_M + 18, bz + 2);
}

export class Board {
  readonly group = new THREE.Group();
  private readonly canvas = document.createElement("canvas");
  private readonly texture = new THREE.CanvasTexture(this.canvas);
  private key = "";

  constructor(private readonly geo: GeometryCache) {
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
  }

  update(room: Rect, walls: readonly SceneWall[]): void {
    const key = JSON.stringify([room, walls]);
    if (key === this.key) return;
    this.key = key;
    disposeMaterials(this.group);
    this.group.clear();
    this.build(room, walls);
  }

  /** Redraw the floor once bundled fonts are ready, so the scale bar uses Baloo. */
  redrawText(room: Rect): void {
    drawFloor(this.canvas, room, BOARD_PAD_M);
    this.texture.needsUpdate = true;
  }

  private build(room: Rect, walls: readonly SceneWall[]): void {
    const pad = BOARD_PAD_M;
    const w = room.maxX - room.minX + 2 * pad;
    const d = room.maxZ - room.minZ + 2 * pad;
    const cx = (room.minX + room.maxX) / 2;
    const cz = (room.minZ + room.maxZ) / 2;

    const slab = new THREE.Mesh(this.geo.roundedBox(w + 0.04, BOARD_THICK_M, d + 0.04, 0.06), paint(palette.boardEdge));
    slab.position.set(cx, -BOARD_THICK_M / 2 - 0.002, cz);
    slab.receiveShadow = true;
    const lip = new THREE.Mesh(this.geo.roundedBox(w + 0.1, 0.05, d + 0.1, 0.025), paint(palette.boardEdgeDark));
    lip.position.set(cx, -BOARD_THICK_M - 0.02, cz);

    drawFloor(this.canvas, room, pad);
    this.texture.needsUpdate = true;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      new THREE.MeshStandardMaterial({ map: this.texture, roughness: 0.95, metalness: 0 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(cx, 0.001, cz);
    floor.receiveShadow = true;
    floor.name = "floor";
    this.group.add(slab, lip, floor);

    const wallPaint = paint(palette.wall);
    const capPaint = paint(palette.wallCap);
    const edge = outlineMaterial(palette.ink, 0.55);
    for (const wall of walls) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(this.geo.roundedBox(wall.length, WALL_HEIGHT_M, wall.thickness, 0.02), wallPaint);
      body.position.y = WALL_HEIGHT_M / 2;
      const cap = new THREE.Mesh(this.geo.roundedBox(wall.length + 0.02, 0.04, wall.thickness + 0.03, 0.015), capPaint);
      cap.position.y = WALL_HEIGHT_M;
      const hull = new THREE.Mesh(this.geo.roundedBox(wall.length + 0.025, WALL_HEIGHT_M + 0.025, wall.thickness + 0.025, 0.02), edge);
      hull.position.y = WALL_HEIGHT_M / 2;
      body.castShadow = true;
      body.receiveShadow = true;
      cap.receiveShadow = true;
      g.add(body, cap, hull);
      g.position.set(wall.x, 0, wall.z);
      g.rotation.y = wall.yaw;
      this.group.add(g);
    }
  }

  dispose(): void {
    disposeMaterials(this.group);
    this.texture.dispose();
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry.type === "PlaneGeometry") m.geometry.dispose();
    });
  }
}
