/**
 * End to end on rendered frames (no video file): the real detection,
 * calibration and mapping code against a synthetic camera whose true pose
 * and hat heights are known.
 */
import { describe, expect, it } from "vitest";
import { solveCalibration } from "../../src/camera/calibration";
import { targetFromHex } from "../../src/camera/color";
import { downscale } from "../../src/camera/frame";
import { cameraMatrix, project } from "../../src/camera/pinhole";
import { EMPTY_STATE, processFrame, type WorkerSpec } from "../../src/camera/pipeline";
import { at, loadFixture, tracksByWorker } from "./fixture";
import { DEFAULT_RENDER, renderFrame } from "./render";
import { buildStaticScene, person, TRUE_HAT_Y, TRUE_POSE } from "./scene";
import { synthCalibration, visible } from "./synth-calibration";

const run = loadFixture(new URL("../../fixtures/counter-a/", import.meta.url).pathname);
const scene = buildStaticScene(run.kitchen);
const tracks = tracksByWorker(run.samples);
const P = cameraMatrix(TRUE_POSE);
const WORK_W = 480;

function peopleAt(t: number) {
  return run.kitchen.layout.workers.flatMap((w, i) => {
    const p = at(tracks.get(w.id) ?? [], t);
    return p ? [person(w, i, p, t)] : [];
  });
}

const calib = synthCalibration(scene, TRUE_POSE, { floorPoints: 6, topPoints: 3, clickSigmaPx: 1.5, seed: 11, cameraKey: "test", hatHeights: TRUE_HAT_Y });
const solved = solveCalibration(calib.pairs, calib.imageSize);
if (!solved.ok) throw new Error(solved.error);

const specs: WorkerSpec[] = run.kitchen.layout.workers.map((w) => {
  const t = targetFromHex(w.color);
  if (!t.ok) throw new Error(t.error);
  return { id: w.id, target: t.value, hatHeightM: TRUE_HAT_Y[w.id]! };
});

describe("synthetic camera, counter-a", () => {
  it("calibrates from 6 floor + 3 box-top clicks to within 2 cm", () => {
    expect(solved.value.model.method).toBe("box-tops");
    expect(solved.value.floorCount).toBe(6);
    expect(solved.value.topCount).toBe(3);
    expect(solved.value.rmsCm).toBeLessThan(2);
  });

  it("finds each visible hat within 3 px and puts it within 8 cm of the truth", () => {
    let checked = 0;
    let worstPx = 0;
    let worstCm = 0;
    for (const t of [3, 14.2, 31.5, 47.1, 60.3, 77.7]) {
      const people = peopleAt(t);
      const frame = renderFrame(scene, people, TRUE_POSE, { ...DEFAULT_RENDER, t });
      const small = downscale(frame, WORK_W);
      const r = processFrame(small, t, EMPTY_STATE, { workers: specs, model: solved.value.model, sourceWidth: frame.width, sourceHeight: frame.height, bounds: scene.view.bounds });
      for (const who of people) {
        const hat = { x: who.p.x, y: who.hatY, z: who.p.z };
        const res = r.workers.find((w) => w.id === who.id)!;
        if (who.armUp || !visible(scene, TRUE_POSE, hat)) continue;
        checked += 1;
        expect(res.pick, `${who.id} at t=${t}`).toBe("found");
        const dCm = Math.hypot(res.raw!.x - who.p.x, res.raw!.z - who.p.z) * 100;
        worstCm = Math.max(worstCm, dCm);
        // Pixel accuracy only for hats with no part hidden (a half-hidden hat's centre shifts).
        const rim = [-0.11, 0.11].flatMap((d) => [{ ...hat, x: hat.x + d }, { ...hat, y: hat.y + d }]);
        if (!rim.every((q) => visible(scene, TRUE_POSE, q))) continue;
        const truth = project(P, hat)!;
        worstPx = Math.max(worstPx, Math.hypot(res.imagePx!.x - truth.x, res.imagePx!.y - truth.y));
      }
    }
    expect(checked).toBeGreaterThanOrEqual(14);
    expect(worstPx).toBeLessThan(3);
    expect(worstCm).toBeLessThan(8);
  });

  it("reports nothing (not a guess) for a hat hidden by the lamp", () => {
    const t = 47.1;
    const people = peopleAt(t);
    const blue = people.find((p) => p.id === "blue")!;
    expect(visible(scene, TRUE_POSE, { x: blue.p.x, y: blue.hatY, z: blue.p.z })).toBe(false);
    const frame = renderFrame(scene, people, TRUE_POSE, { ...DEFAULT_RENDER, t });
    const r = processFrame(downscale(frame, WORK_W), t, EMPTY_STATE, { workers: specs, model: solved.value.model, sourceWidth: frame.width, sourceHeight: frame.height });
    expect(r.workers.find((w) => w.id === "blue")!.pick).toBe("none");
    expect(r.samples.map((s) => s.workerId)).not.toContain("blue");
  });

  it.each([0.5, 1.3])("still finds every visible hat at exposure %s (lighting change, no re-sampling)", (exposure) => {
    const t = 60.3;
    const people = peopleAt(t);
    const frame = renderFrame(scene, people, TRUE_POSE, { ...DEFAULT_RENDER, t, exposure });
    const r = processFrame(downscale(frame, WORK_W), t, EMPTY_STATE, { workers: specs, model: solved.value.model, sourceWidth: frame.width, sourceHeight: frame.height });
    for (const who of people) {
      const res = r.workers.find((w) => w.id === who.id)!;
      expect(res.pick, who.id).toBe("found");
      expect(Math.hypot(res.raw!.x - who.p.x, res.raw!.z - who.p.z)).toBeLessThan(0.08);
    }
  });

  it("ignores the red mug (smaller than a hat)", () => {
    const frame = renderFrame(scene, [], TRUE_POSE, { ...DEFAULT_RENDER, t: 5 });
    const r = processFrame(downscale(frame, WORK_W), 5, EMPTY_STATE, { workers: specs, model: solved.value.model, sourceWidth: frame.width, sourceHeight: frame.height });
    expect(r.workers.every((w) => w.pick === "none")).toBe(true);
  });
});
