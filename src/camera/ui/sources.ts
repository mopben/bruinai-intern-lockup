/**
 * Picture sources: a webcam (the phone as Continuity Camera or over a cable)
 * or a video file. Errors are turned into sentences an operator can act on.
 */
export interface CameraChoice {
  readonly deviceId: string;
  readonly label: string;
}

const REMEMBERED = "dryrun.camera.deviceId";

export function rememberedCamera(): string | undefined {
  try {
    return globalThis.localStorage?.getItem(REMEMBERED) ?? undefined;
  } catch {
    return undefined;
  }
}

export function rememberCamera(deviceId: string): void {
  try {
    globalThis.localStorage?.setItem(REMEMBERED, deviceId);
  } catch {
    /* private mode: the choice just is not remembered */
  }
}

export async function listCameras(): Promise<readonly CameraChoice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === "videoinput")
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }));
}

export function friendlyCameraError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Camera access was refused. Click the camera icon in the address bar, allow access, then press Try again.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No camera found. Connect the phone (Continuity Camera or USB cable), then press Try again.";
    case "NotReadableError":
    case "AbortError":
      return "The camera is busy in another app (FaceTime, Zoom, Photo Booth?). Close that app, then press Try again.";
    default:
      if (!navigator.mediaDevices?.getUserMedia) {
        return "This browser cannot use cameras on this address. Open the page as http://localhost:5179/camera on the laptop.";
      }
      return `The camera could not start (${error instanceof Error ? error.message : String(error)}). Press Try again.`;
  }
}

export async function openCamera(deviceId: string | undefined): Promise<MediaStream> {
  const size = { width: { ideal: 1920 }, height: { ideal: 1080 } };
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: deviceId ? { ...size, deviceId: { exact: deviceId } } : size,
      audio: false,
    });
  } catch (error) {
    // A remembered camera that is gone: fall back to any camera once.
    if (deviceId && error instanceof DOMException && (error.name === "OverconstrainedError" || error.name === "NotFoundError")) {
      return navigator.mediaDevices.getUserMedia({ video: size, audio: false });
    }
    throw error;
  }
}

export function stopStream(stream: MediaStream | undefined): void {
  stream?.getTracks().forEach((t) => t.stop());
}

/** Starts a download of text as a file. */
export function download(name: string, text: string, type = "application/json"): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
