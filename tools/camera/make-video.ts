/**
 * Synthetic camera video from a fixture run.
 *
 *   npx tsx tools/camera/make-video.ts fixtures/counter-a <out-dir> [--seconds 90] [--png-at 12.3]
 *
 * Writes <out-dir>/camera.webm (VP8, plays in any Chromium) and camera.mp4
 * (H.264), truth.json (camera pose, true hat heights), and two calibration
 * files in the page's format: calibration-measured.json (hat heights taped)
 * and calibration-default.json (everyone at the 1.65 m default).
 * --png-at writes one frame as frame.png instead, for a quick look.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { serialiseCalibration } from "../../src/camera/calib-file";
import { at, loadFixture, tracksByWorker } from "./fixture";
import { DEFAULT_RENDER, renderFrame } from "./render";
import { buildStaticScene, person, TRUE_HAT_Y, TRUE_POSE } from "./scene";
import { synthCalibration } from "./synth-calibration";

const FFMPEG = process.env.FFMPEG ?? "/opt/homebrew/bin/ffmpeg";
export const FPS = 10;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function encode(frames: AsyncIterable<Uint8ClampedArray> | Iterable<Uint8ClampedArray>, args: readonly string[]): Promise<void> {
  const ff = spawn(FFMPEG, ["-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${TRUE_POSE.width}x${TRUE_POSE.height}`, "-r", String(FPS), "-i", "-", ...args], {
    stdio: ["pipe", "inherit", "inherit"],
  });
  const done = new Promise<void>((res, rej) => ff.on("close", (code) => (code === 0 ? res() : rej(new Error(`ffmpeg exited with ${code}`)))));
  for await (const f of frames) {
    if (!ff.stdin.write(Buffer.from(f.buffer, f.byteOffset, f.byteLength))) await new Promise((r) => ff.stdin.once("drain", r));
  }
  ff.stdin.end();
  await done;
}

async function main() {
  const [dirArg, outArg] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (!dirArg || !outArg) throw new Error("Usage: make-video.ts <fixture-dir> <out-dir> [--seconds N] [--png-at T]");
  const run = loadFixture(resolve(dirArg));
  const scene = buildStaticScene(run.kitchen);
  const tracks = tracksByWorker(run.samples);
  const out = resolve(outArg);
  mkdirSync(out, { recursive: true });
  const workers = run.kitchen.layout.workers;
  const frameAt = (t: number) =>
    renderFrame(
      scene,
      workers.flatMap((w, i) => {
        const p = at(tracks.get(w.id) ?? [], t);
        return p ? [person(w, i, p, t)] : [];
      }),
      TRUE_POSE,
      { ...DEFAULT_RENDER, t },
    );

  const pngAt = arg("--png-at");
  if (pngAt !== undefined) {
    await encode([frameAt(Number(pngAt)).data as Uint8ClampedArray], ["-frames:v", "1", join(out, "frame.png")]);
    process.stdout.write(`Wrote ${join(out, "frame.png")}\n`);
    return;
  }
  const seconds = Math.min(Number(arg("--seconds") ?? run.duration), run.duration);
  const n = Math.floor(seconds * FPS) + 1;
  const frames: Uint8ClampedArray[] = [];
  for (let k = 0; k < n; k += 1) frames.push(frameAt(k / FPS).data as Uint8ClampedArray);
  await encode(frames, ["-c:v", "libvpx", "-b:v", "4M", "-g", "10", "-pix_fmt", "yuv420p", join(out, "camera.webm")]);
  await encode(frames, ["-c:v", "libx264", "-crf", "20", "-g", "10", "-pix_fmt", "yuv420p", join(out, "camera.mp4")]);

  const calOpts = { floorPoints: 6, topPoints: 3, clickSigmaPx: 1.5, seed: 11, cameraKey: `file:camera.webm` };
  writeFileSync(join(out, "calibration-measured.json"), serialiseCalibration(synthCalibration(scene, TRUE_POSE, { ...calOpts, hatHeights: TRUE_HAT_Y })));
  writeFileSync(join(out, "calibration-default.json"), serialiseCalibration(synthCalibration(scene, TRUE_POSE, { ...calOpts, hatHeights: {} })));
  writeFileSync(
    join(out, "truth.json"),
    `${JSON.stringify({ fixture: basename(resolve(dirArg)), fps: FPS, frames: n, pose: TRUE_POSE, hatHeights: TRUE_HAT_Y }, null, 2)}\n`,
  );
  process.stdout.write(`Wrote ${n} frames to ${out}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
