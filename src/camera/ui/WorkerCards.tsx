/**
 * One card per worker: hat colour, locked / holding / lost, how steady the
 * lock has been, a live mask (what the tracker sees as "their hat"), and
 * buttons to sample the colour and measure the hat height.
 */
import { useSignalEffect } from "@preact/signals";
import { useRef } from "preact/hooks";
import { hexToRgb, hsvToRgb } from "../color";
import { DEFAULT_HAT_HEIGHT_M, type WorkerResult } from "../pipeline";
import type { CameraStore } from "./store";

function statusOf(r: WorkerResult | undefined, calibrated: boolean): { word: string; tone: string } {
  if (!r) return { word: "waiting", tone: "idle" };
  if (r.track.status === "locked") return { word: "locked", tone: "ok" };
  if (r.track.status === "holding") return { word: "holding", tone: "warn" };
  if (r.pick === "ambiguous") return { word: "two hats?", tone: "bad" };
  if (r.rejected === "no-calibration" || (!calibrated && r.pick === "found")) return { word: "seen, not calibrated", tone: "warn" };
  if (r.rejected === "outside-room") return { word: "outside the room", tone: "bad" };
  return { word: "lost", tone: "bad" };
}

function Mask({ store, id, color }: { readonly store: CameraStore; readonly id: string; readonly color: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useSignalEffect(() => {
    const r = store.result.value;
    const canvas = ref.current;
    if (!r || !canvas) return;
    const w = r.workers.find((x) => x.id === id);
    if (!w) return;
    const { width, height } = r.planes;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(width, height);
    const rgb = hexToRgb(color) ?? { r: 255, g: 255, b: 255 };
    for (let i = 0; i < w.mask.length; i += 1) {
      const on = w.mask[i] === 1;
      img.data[i * 4] = on ? rgb.r : 40;
      img.data[i * 4 + 1] = on ? rgb.g : 34;
      img.data[i * 4 + 2] = on ? rgb.b : 30;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  });
  return <canvas ref={ref} class="mask" aria-label="What the tracker sees as this hat" />;
}

export function WorkerCards({ store }: { readonly store: CameraStore }) {
  const specs = store.specs.value;
  if (specs.length === 0) return <p class="hint">Hat colours come with the kitchen.</p>;
  const calibrated = store.model.value !== undefined;
  const active = store.activeWorker.value;
  const mode = store.mode.value;
  return (
    <div class="workers">
      {specs.map((s) => {
        const r = store.result.value?.workers.find((w) => w.id === s.id);
        const st = statusOf(r, calibrated);
        const rate = store.lockRate.value.get(s.id) ?? 0;
        const sampled = hsvToRgb({ h: s.target.h, s: s.target.s, v: s.target.v });
        const choose = (m: "sample" | "height", text: string) => {
          store.mode.value = m;
          store.activeWorker.value = s.id;
          store.say(text);
        };
        return (
          <div key={s.id} class={`worker tone-${st.tone} ${active === s.id ? "is-active" : ""}`}>
            <div class="worker-head">
              <span class="hat" style={{ background: s.color }} title="Hat colour from the kitchen" />
              <span class="hat sampled" style={{ background: `rgb(${sampled.r},${sampled.g},${sampled.b})` }} title={s.sampled ? "Colour the camera sees (sampled)" : "Not sampled yet"} />
              <strong>{s.name}</strong>
              <span class={`status tone-${st.tone}`}>{st.word}</span>
            </div>
            <div class="worker-body">
              <Mask store={store} id={s.id} color={s.color} />
              <div class="worker-side">
                <div class="meter" title="Share of recent frames with this hat found">
                  <div style={{ width: `${Math.round(rate * 100)}%` }} />
                </div>
                <span class="small">{Math.round(rate * 100)}% of frames</span>
                <label class="small">
                  Hat height{" "}
                  <input
                    type="number"
                    min={1}
                    max={2.3}
                    step={0.01}
                    value={(s.hatHeightM ?? DEFAULT_HAT_HEIGHT_M).toFixed(2)}
                    onChange={(e) => store.setHatHeight(s.id, Number((e.target as HTMLInputElement).value))}
                  />{" "}
                  m
                </label>
                <div class="row">
                  <button class={mode === "sample" && active === s.id ? "on" : ""} onClick={() => choose("sample", `Click the middle of ${s.name}'s hat in the picture.`)}>
                    Sample
                  </button>
                  <button
                    class={mode === "height" && active === s.id ? "on" : ""}
                    disabled={!calibrated}
                    onClick={() => choose("height", `Ask ${s.name} to stand on their spot at their station, then click their hat.`)}
                  >
                    Measure
                  </button>
                  {s.sampled && (
                    <button class="quiet" onClick={() => store.setColour(s.id, undefined)} title="Go back to the colour from the kitchen">
                      Reset
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
