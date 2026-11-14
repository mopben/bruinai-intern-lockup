/**
 * Where the picture comes from: a camera (remembered) or a video file
 * (also by drag and drop), with play / pause and a scrubber for files.
 */
import { signal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { friendlyCameraError, listCameras, openCamera, rememberCamera, rememberedCamera, stopStream, type CameraChoice } from "./sources";
import type { CameraStore } from "./store";

const cameras = signal<readonly CameraChoice[]>([]);
const cameraError = signal<string | undefined>(undefined);
const playing = signal(false);
const clock = signal({ t: 0, duration: 0 });

let stream: MediaStream | undefined;
let objectUrl: string | undefined;

function whenReady(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    if (video.readyState >= 2 && video.videoWidth > 0) return resolve();
    const ok = () => (cleanup(), resolve());
    const bad = () => (cleanup(), reject(new Error("This video cannot be played here. Try an .mp4 (H.264) or .webm file.")));
    const cleanup = () => {
      video.removeEventListener("loadeddata", ok);
      video.removeEventListener("error", bad);
    };
    video.addEventListener("loadeddata", ok);
    video.addEventListener("error", bad);
  });
}

function adopt(store: CameraStore, video: HTMLVideoElement) {
  store.size.value = { width: video.videoWidth, height: video.videoHeight };
  store.result.value = undefined;
  store.reloadCalibration();
}

export async function startCamera(store: CameraStore, video: HTMLVideoElement, deviceId: string | undefined): Promise<void> {
  cameraError.value = undefined;
  try {
    stopStream(stream);
    stream = await openCamera(deviceId);
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = undefined;
    video.removeAttribute("src");
    video.srcObject = stream;
    await video.play();
    await whenReady(video);
    const track = stream.getVideoTracks()[0];
    const settings = track?.getSettings();
    const id = settings?.deviceId ?? deviceId ?? "default";
    rememberCamera(id);
    cameras.value = await listCameras();
    const label = track?.label || cameras.value.find((c) => c.deviceId === id)?.label || "Camera";
    store.source.value = { kind: "camera", key: `cam:${label}`, label, deviceId: id };
    adopt(store, video);
    track?.addEventListener("ended", () => {
      cameraError.value = "The camera disconnected. Reconnect the phone, then press Try again.";
      store.say("The camera disconnected. The stage will fall back to the recorded positions.", "warn");
    });
  } catch (error) {
    cameraError.value = friendlyCameraError(error);
  }
}

export async function openVideoFile(store: CameraStore, video: HTMLVideoElement, file: File): Promise<void> {
  if (!file.type.startsWith("video/") && !/\.(mp4|mov|webm|m4v|mkv)$/i.test(file.name)) {
    store.say(`${file.name} is not a video file.`, "warn");
    return;
  }
  stopStream(stream);
  stream = undefined;
  video.srcObject = null;
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(file);
  video.src = objectUrl;
  video.loop = false;
  try {
    await whenReady(video);
    video.pause();
    store.source.value = { kind: "file", key: `file:${file.name}`, name: file.name };
    adopt(store, video);
    store.say(`Opened ${file.name} (${video.videoWidth}x${video.videoHeight}, ${video.duration.toFixed(1)} s).`);
  } catch (error) {
    store.say(error instanceof Error ? error.message : "That video could not be opened.", "warn");
  }
}

export function SourceBar({ store, video }: { readonly store: CameraStore; readonly video: HTMLVideoElement | null }) {
  useEffect(() => {
    if (!video) return;
    const sync = () => {
      playing.value = !video.paused && !video.ended;
      clock.value = { t: video.currentTime, duration: Number.isFinite(video.duration) ? video.duration : 0 };
    };
    const events = ["play", "pause", "ended", "timeupdate", "loadedmetadata", "seeked"] as const;
    events.forEach((e) => video.addEventListener(e, sync));
    void listCameras().then((c) => (cameras.value = c)).catch(() => undefined);
    return () => events.forEach((e) => video.removeEventListener(e, sync));
  }, [video]);

  const src = store.source.value;
  const isFile = src.kind === "file";
  const chosen = src.kind === "camera" ? src.deviceId : rememberedCamera();
  return (
    <div class="sourcebar">
      <select
        aria-label="Camera"
        value={src.kind === "camera" ? src.deviceId : ""}
        onChange={(e) => video && startCamera(store, video, (e.target as HTMLSelectElement).value || undefined)}
      >
        <option value="">{cameras.value.length === 0 ? "Camera…" : "Choose a camera…"}</option>
        {cameras.value.map((c) => (
          <option key={c.deviceId} value={c.deviceId}>
            {c.label}
          </option>
        ))}
      </select>
      <button onClick={() => video && startCamera(store, video, chosen)}>{src.kind === "camera" ? "Restart camera" : cameraError.value ? "Try again" : "Use camera"}</button>
      <label class="button">
        Open video file
        <input type="file" accept="video/*,.mov,.mp4,.webm" hidden onChange={(e) => {
          const input = e.target as HTMLInputElement;
          const f = input.files?.[0];
          input.value = "";
          if (f && video) void openVideoFile(store, video, f);
        }} />
      </label>
      {isFile && video && (
        <span class="file-controls">
          <button onClick={() => (video.paused ? void video.play() : video.pause())}>{playing.value ? "Pause" : "Play"}</button>
          <input
            type="range"
            min={0}
            max={clock.value.duration}
            step={0.1}
            value={clock.value.t}
            aria-label="Position in the video"
            onInput={(e) => (video.currentTime = Number((e.target as HTMLInputElement).value))}
          />
          <span class="small">
            {clock.value.t.toFixed(1)} / {clock.value.duration.toFixed(1)} s
          </span>
        </span>
      )}
      {cameraError.value && <p class="warn-line">{cameraError.value}</p>}
    </div>
  );
}
