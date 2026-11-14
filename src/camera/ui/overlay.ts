/**
 * Draws on top of the camera picture: the kitchen's box outlines projected
 * through the calibration (misalignment shows at a glance), the clicked
 * calibration points with their error, and a ring round each tracked hat.
 */
import type { CalibrationFile } from "../calib-file";
import { projectAt, type CameraModel } from "../camera-model";
import type { Pt } from "../homography";
import type { KitchenView } from "../kitchen";
import type { FrameResult } from "../pipeline";

export interface OverlayInput {
  readonly view?: KitchenView;
  readonly model?: CameraModel;
  readonly calib?: CalibrationFile;
  readonly errorsCm?: readonly number[];
  readonly result?: FrameResult;
  readonly colours: Readonly<Record<string, { color: string; name: string }>>;
  readonly showCalibration: boolean;
  readonly selectedRef?: string;
}

export const errorTone = (cm: number): string => (cm < 5 ? "#2f9c8a" : cm < 15 ? "#f2a93b" : "#e2543a");

function path(ctx: CanvasRenderingContext2D, pts: readonly (Pt | undefined)[], close: boolean): boolean {
  if (pts.some((p) => !p)) return false;
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p!.x, p!.y) : ctx.lineTo(p!.x, p!.y)));
  if (close) ctx.closePath();
  return true;
}

function drawBoxes(ctx: CanvasRenderingContext2D, view: KitchenView, model: CameraModel, k: number, strong: boolean) {
  const sc = (p: Pt | undefined) => (p ? { x: p.x * k, y: p.y * k } : undefined);
  ctx.lineWidth = strong ? 2.5 : 1.5;
  for (const b of view.boxes) {
    const floor = b.footprint.map((p) => sc(projectAt(model, p, 0)));
    const top = b.footprint.map((p) => sc(projectAt(model, p, b.height)));
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = "rgba(255,250,240,0.9)";
    if (path(ctx, floor, true)) ctx.stroke();
    ctx.setLineDash([]);
    if (b.height > 0.3) {
      ctx.strokeStyle = strong ? "rgba(47,156,138,0.95)" : "rgba(47,156,138,0.6)";
      if (path(ctx, top, true)) ctx.stroke();
      b.footprint.forEach((_, i) => {
        if (path(ctx, [floor[i], top[i]], false)) ctx.stroke();
      });
    }
    const c = top.filter((p): p is Pt => p !== undefined);
    if (strong && c.length === 4) {
      const cx = c.reduce((s, p) => s + p.x, 0) / 4;
      const cy = c.reduce((s, p) => s + p.y, 0) / 4;
      label(ctx, b.name, cx, cy, "#3b2f28");
    }
  }
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, fill: string) {
  ctx.font = "700 14px 'Nunito Variable', system-ui, sans-serif";
  const w = ctx.measureText(text).width + 12;
  ctx.fillStyle = "rgba(255,250,240,0.92)";
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - 11, w, 22, 11);
  ctx.fill();
  ctx.fillStyle = fill;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y + 1);
}

function drawPairs(ctx: CanvasRenderingContext2D, o: OverlayInput, k: number) {
  o.calib?.pairs.forEach((p, i) => {
    const x = p.image.x * k;
    const y = p.image.y * k;
    const err = o.errorsCm?.[i];
    const tone = err === undefined ? "#5b8fa8" : errorTone(err);
    const back = o.model ? projectAt(o.model, { x: p.world.x, z: p.world.z }, p.world.y) : undefined;
    if (back) {
      ctx.strokeStyle = tone;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(back.x * k, back.y * k);
      ctx.stroke();
    }
    ctx.strokeStyle = "#fffaf0";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(x - 8, y);
    ctx.lineTo(x + 8, y);
    ctx.moveTo(x, y - 8);
    ctx.lineTo(x, y + 8);
    ctx.stroke();
    ctx.strokeStyle = tone;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.fillStyle = tone;
    ctx.font = "800 13px 'Nunito Variable', system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(String(i + 1), x + 9, y - 8);
  });
  const sel = o.selectedRef && o.view?.refs.find((r) => r.id === o.selectedRef);
  if (sel && o.model) {
    const p = projectAt(o.model, { x: sel.world.x, z: sel.world.z }, sel.world.y);
    if (p) {
      ctx.strokeStyle = "#f2a93b";
      ctx.lineWidth = 3;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(p.x * k, p.y * k, 18, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

function drawHats(ctx: CanvasRenderingContext2D, o: OverlayInput, k: number) {
  const r = o.result;
  if (!r) return;
  for (const w of r.workers) {
    if (!w.imagePx || !w.blob) continue;
    const who = o.colours[w.id];
    const work = r.planes.width;
    const srcPerWork = (o.calib?.imageSize.width ?? work) / work;
    const radius = Math.max(14, Math.sqrt(w.blob.area / Math.PI) * srcPerWork * k * 1.6);
    const x = w.imagePx.x * k;
    const y = w.imagePx.y * k;
    ctx.lineWidth = 7;
    ctx.strokeStyle = "#fffaf0";
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 4;
    ctx.strokeStyle = who?.color ?? "#3b2f28";
    if (w.rejected) ctx.setLineDash([5, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
    label(ctx, w.rejected === "outside-room" ? `${who?.name ?? w.id}: outside the room?` : who?.name ?? w.id, x, y - radius - 16, "#3b2f28");
  }
}

/** Draws everything; `k` is display pixels per source pixel. */
export function drawOverlay(ctx: CanvasRenderingContext2D, o: OverlayInput, k: number): void {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (o.view && o.model) drawBoxes(ctx, o.view, o.model, k, o.showCalibration);
  if (o.showCalibration) drawPairs(ctx, o, k);
  drawHats(ctx, o, k);
}
