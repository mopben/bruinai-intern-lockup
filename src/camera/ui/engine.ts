/**
 * The frame loop: video element -> working-size pixels -> pipeline -> store,
 * plus sending reports (~10 Hz), recording, and fast whole-file processing.
 * The same code runs for the webcam and for a video file.
 */
import type { PositionReport } from "../../inputs/protocol";
import type { Frame } from "../frame";
import { EMPTY_STATE, processFrame, type FrameResult, type PipelineState } from "../pipeline";
import { addSamples, recordingToJsonl, startRecording } from "../recorder";
import { download } from "./sources";
import type { CameraStore } from "./store";

/** Pixels across the picture the tracker works on (speed vs. small far hats). */
export const WORK_WIDTH = 480;
const TICK_MS = 12;
/** Smoothing of the per-worker lock rate (per processed frame; ~2 s at 30 fps). */
const LOCK_RATE_ALPHA = 0.03;
/** Reports and recorded samples per second. */
export const REPORT_HZ = 10;

export function createEngine(store: CameraStore, video: HTMLVideoElement) {
  const work = document.createElement("canvas");
  const ctx = work.getContext("2d", { willReadFrequently: true });
  let state: PipelineState = EMPTY_STATE;
  let lastT = Number.NEGATIVE_INFINITY;
  let lastSent = Number.NEGATIVE_INFINITY;
  let lastRecorded = Number.NEGATIVE_INFINITY;
  let recordT0 = 0;
  let stopped = false;
  let busy = false;

  function grab(): Frame | undefined {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!ctx || vw === 0 || vh === 0) return undefined;
    const w = Math.min(WORK_WIDTH, vw);
    const h = Math.round((w * vh) / vw);
    if (work.width !== w || work.height !== h) {
      work.width = w;
      work.height = h;
    }
    ctx.drawImage(video, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
  }

  function step(t: number): FrameResult | undefined {
    const frame = grab();
    const sz = store.size.value;
    if (!frame || !sz) return undefined;
    if (t < lastT) state = EMPTY_STATE; // seeked backwards
    lastT = t;
    const k = store.kitchen.value;
    const r = processFrame(frame, t, state, {
      workers: store.specs.value,
      model: store.model.value,
      sourceWidth: sz.width,
      sourceHeight: sz.height,
      bounds: k?.view.bounds,
    });
    state = r.state;
    store.result.value = r;
    store.lockRate.value = new Map(
      r.workers.map((w) => {
        const prev = store.lockRate.value.get(w.id) ?? 0;
        return [w.id, prev + LOCK_RATE_ALPHA * ((w.raw ? 1 : 0) - prev)] as const;
      }),
    );
    return r;
  }

  const clockT = () => (store.source.value.kind === "file" ? video.currentTime : performance.now() / 1000);

  function afterStep(r: FrameResult, t: number) {
    if (t - lastSent >= 1 / REPORT_HZ - 0.005) {
      lastSent = t;
      if (r.samples.length > 0) {
        const report: PositionReport = { type: "report", samples: r.samples.map((s) => ({ workerId: s.workerId, x: round3(s.x), z: round3(s.z) })), cameraT: round3(t) };
        if (store.link.send("positions", report)) store.reportsSent.value += 1;
      }
    }
    const rec = store.recording.value;
    if (rec && t - lastRecorded >= 1 / REPORT_HZ - 0.005) {
      lastRecorded = t;
      store.recording.value = addSamples(rec, t - recordT0, r.fresh);
    }
  }

  let lastFrameKey = Number.NaN;
  /** Camera frames are processed at most this often (phones deliver 30 fps). */
  const MIN_CAMERA_INTERVAL_S = 1 / 30;

  // A timer, not requestAnimationFrame: rAF stops when the window is covered
  // (the stage window on top), timers only slow down when the tab is hidden.
  function tick() {
    if (stopped) return;
    setTimeout(tick, TICK_MS);
    if (busy || video.paused || video.ended || video.readyState < 2) return;
    const t = clockT();
    const isFile = store.source.value.kind === "file";
    // Only new pictures: a new video time for files, a frame interval for the camera.
    if (isFile ? t === lastFrameKey : t - lastFrameKey < MIN_CAMERA_INTERVAL_S) return;
    lastFrameKey = t;
    const r = step(t);
    if (r) afterStep(r, t);
  }

  function startRecordingNow() {
    recordT0 = clockT();
    lastRecorded = Number.NEGATIVE_INFINITY;
    store.recording.value = startRecording(new Date());
  }

  function stopRecordingAndSave(fileName: string) {
    const rec = store.recording.value;
    store.recording.value = undefined;
    if (!rec || rec.samples.length === 0) {
      store.say("Nothing was recorded: no hat was tracked while recording.", "warn");
      return;
    }
    download(fileName, recordingToJsonl(rec, REPORT_HZ), "application/x-ndjson");
    store.say(`Saved ${rec.samples.length} samples to ${fileName}.`);
  }

  function seek(t: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("The video did not seek (is the file damaged?)")), 5000);
      video.addEventListener(
        "seeked",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      video.currentTime = t;
    });
  }

  /** Steps through the whole file at 10 Hz of video time, as fast as the browser decodes. */
  async function processWholeFile(fileName: string): Promise<void> {
    if (store.source.value.kind !== "file" || !Number.isFinite(video.duration)) {
      store.say("Open a video file first.", "warn");
      return;
    }
    if (!store.model.value) {
      store.say("Calibrate first: the floor positions need it.", "warn");
      return;
    }
    video.pause();
    busy = true;
    state = EMPTY_STATE;
    lastT = Number.NEGATIVE_INFINITY;
    const total = Math.floor(video.duration * REPORT_HZ) + 1;
    let rec = startRecording(new Date());
    try {
      for (let k = 0; k < total; k += 1) {
        const t = Math.min(video.duration, k / REPORT_HZ);
        await seek(t);
        const r = step(t);
        if (r) rec = addSamples(rec, t, r.fresh);
        if (k % 5 === 0) store.offline.value = { done: k, total };
      }
      download(fileName, recordingToJsonl(rec, REPORT_HZ), "application/x-ndjson");
      store.say(`Processed ${total} frames (${video.duration.toFixed(1)} s of video) into ${fileName}: ${rec.samples.length} samples.`);
    } catch (error) {
      store.say(error instanceof Error ? error.message : "Processing stopped.", "warn");
    } finally {
      busy = false;
      store.offline.value = undefined;
      state = EMPTY_STATE;
    }
  }

  // A paused file still shows its hats after a seek or on load.
  const stillFrame = () => {
    if (!busy && video.paused && video.readyState >= 2) step(clockT());
  };
  video.addEventListener("seeked", stillFrame);
  video.addEventListener("loadeddata", stillFrame);

  setTimeout(tick, TICK_MS);
  return {
    startRecording: startRecordingNow,
    stopRecordingAndSave,
    processWholeFile,
    /** One frame from the current picture (e.g. while paused). */
    refresh: () => {
      const r = step(clockT());
      return r;
    },
    lastPlanes: () => store.result.value?.planes,
    dispose() {
      stopped = true;
      video.removeEventListener("seeked", stillFrame);
      video.removeEventListener("loadeddata", stillFrame);
    },
  };
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

export type Engine = ReturnType<typeof createEngine>;
