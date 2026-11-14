/**
 * The bottleneck glow: a soft tomato light on the floor around a station
 * whose orders are piling up. Drawn once per box size into a canvas texture
 * (a blurred rounded ring), so it reads as light, not as a flat slab.
 */
import * as THREE from "three";
import { palette } from "../theme/tokens";

const PX_PER_M = 120;
/** How far the glow reaches beyond the box footprint, metres. */
export const GLOW_REACH_M = 0.42;

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** A plane (lying on the floor) of size w+2*reach by d+2*reach with a glowing ring texture. */
export function makeGlow(w: number, d: number): { readonly mesh: THREE.Mesh; readonly material: THREE.MeshBasicMaterial } {
  const W = w + GLOW_REACH_M * 2;
  const D = d + GLOW_REACH_M * 2;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(16, Math.ceil(W * PX_PER_M));
  canvas.height = Math.max(16, Math.ceil(D * PX_PER_M));
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const inset = (GLOW_REACH_M * PX_PER_M) * 0.62;
    const pass = (blur: number, width: number, alpha: number) => {
      ctx.save();
      ctx.shadowColor = palette.alert;
      ctx.shadowBlur = blur;
      ctx.strokeStyle = palette.alert;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = width;
      roundRect(ctx, inset, inset, canvas.width - inset * 2, canvas.height - inset * 2, 0.12 * PX_PER_M);
      ctx.stroke();
      ctx.restore();
    };
    pass(28, 10, 0.55);
    pass(12, 7, 0.9);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2), material);
  mesh.renderOrder = 2;
  return { mesh, material };
}
