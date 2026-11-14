/**
 * The big picture with overlays. Clicks mean different things per mode:
 * calibrate (match the chosen map point), sample (a hat's colour), height
 * (a hat whose wearer stands on their mark).
 */
import { useSignalEffect } from "@preact/signals";
import { useRef } from "preact/hooks";
import { solveHatHeight } from "../camera-model";
import { targetFromSamples } from "../color";
import { samplePatch } from "../frame";
import type { Pt } from "../homography";
import type { Engine } from "./engine";
import { drawOverlay } from "./overlay";
import type { CameraStore } from "./store";

interface Props {
  readonly store: CameraStore;
  readonly engine: Engine | undefined;
  readonly videoRef: { current: HTMLVideoElement | null };
}

/** Patch radius (working pixels) sampled round a click on a hat. */
const SAMPLE_RADIUS = 3;

export function CameraView({ store, engine, videoRef }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useSignalEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    const solved = store.solved.value;
    const k = store.kitchen.value;
    const input = {
      view: k?.view,
      model: store.model.value,
      calib: store.calib.value,
      errorsCm: solved?.ok ? solved.value.errorsCm : undefined,
      result: store.result.value,
      colours: Object.fromEntries(store.specs.value.map((s) => [s.id, { color: s.color, name: s.name }])),
      showCalibration: store.mode.value === "calibrate",
      selectedRef: store.selectedRef.value,
    };
    const size = store.size.value;
    if (!canvas || !video || !size) return;
    const dpr = globalThis.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawOverlay(ctx, input, w / size.width);
  });

  function sourcePoint(e: MouseEvent): Pt | undefined {
    const canvas = canvasRef.current;
    const size = store.size.value;
    if (!canvas || !size) return undefined;
    const rect = canvas.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * size.width, y: ((e.clientY - rect.top) / rect.height) * size.height };
  }

  function onClick(e: MouseEvent) {
    const px = sourcePoint(e);
    if (!px) return;
    const mode = store.mode.value;
    if (mode === "calibrate") return calibrateAt(px);
    if (mode === "sample") return sampleAt(px);
    if (mode === "height") return heightAt(px);
  }

  function calibrateAt(px: Pt) {
    const refId = store.selectedRef.value;
    const ref = store.kitchen.value?.view.refs.find((r) => r.id === refId);
    if (!ref) {
      store.say("First pick a point on the map, then click the same spot here.", "warn");
      return;
    }
    store.addPair({ refId: ref.id, label: ref.label, world: ref.world, image: px });
    store.selectedRef.value = undefined;
    store.say(`Matched: ${ref.label}. Pick the next point on the map.`);
  }

  function sampleAt(px: Pt) {
    const id = store.activeWorker.value;
    const spec = store.specs.value.find((s) => s.id === id);
    const planes = store.result.value?.planes ?? engine?.refresh()?.planes;
    const size = store.size.value;
    if (!spec || !planes || !size) {
      store.say("Choose whose hat to sample (Sample on their card), then click the hat.", "warn");
      return;
    }
    const k = planes.width / size.width;
    const t = targetFromSamples(samplePatch(planes, px.x * k, px.y * k, SAMPLE_RADIUS));
    if (!t.ok) {
      store.say(t.error, "warn");
      return;
    }
    store.setColour(spec.id, t.value);
    store.activeWorker.value = undefined;
    store.mode.value = "track";
    store.say(`${spec.name}'s hat colour sampled. Check their mask shows one clean blob.`);
  }

  function heightAt(px: Pt) {
    const id = store.activeWorker.value;
    const spec = store.specs.value.find((s) => s.id === id);
    const stand = id ? store.kitchen.value?.view.stands[id] : undefined;
    const model = store.model.value;
    if (!spec || !stand || !model) {
      store.say("Calibrate first, then choose whose hat to measure.", "warn");
      return;
    }
    const h = solveHatHeight(model, px, stand);
    if (!h.ok) {
      store.say(h.error, "warn");
      return;
    }
    store.setHatHeight(spec.id, h.value);
    store.activeWorker.value = undefined;
    store.mode.value = "track";
    store.say(`${spec.name}'s hat measured at ${h.value.toFixed(2)} m.`);
  }

  const size = store.size.value;
  const mode = store.mode.value;
  return (
    <div class={`cam-view mode-${mode}`} style={size ? { aspectRatio: `${size.width} / ${size.height}` } : undefined}>
      <video ref={videoRef} muted playsInline />
      <canvas ref={canvasRef} onClick={onClick} aria-label="Camera picture" />
      {!size && <div class="cam-empty">Choose the phone camera or open a video file.</div>}
    </div>
  );
}
