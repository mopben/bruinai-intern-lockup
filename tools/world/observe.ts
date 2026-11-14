/**
 * What the fixed phone camera would report: each worker's floor position
 * about 10 times a second, with a few centimetres of noise, a small constant
 * calibration offset, the odd missed frame and one short occlusion.
 */
import type { PositionSample } from "../../src/core/types";
import { positionAt } from "./motion";
import { chance, clippedNormal, normal, uniform, type Rng } from "./rng";
import type { SimResult } from "./sim";

export interface CameraModel {
  readonly hz: number;
  /** Per-axis noise, m (clipped at three times this). */
  readonly noise: number;
  /** Spread of the constant calibration offset, m. */
  readonly bias: number;
  /** Chance a single sample is missing (hat not found in that frame). */
  readonly dropChance: number;
  /** Frame time wobble, s. */
  readonly jitter: number;
}

export const CAMERA: CameraModel = { hz: 10, noise: 0.022, bias: 0.012, dropChance: 0.012, jitter: 0.008 };

const r3 = (v: number): number => Math.round(v * 1000) / 1000;

export function observePositions(sim: SimResult, rng: Rng, cam: CameraModel = CAMERA): readonly PositionSample[] {
  const bias = { x: normal(rng, 0, cam.bias), z: normal(rng, 0, cam.bias) };
  const frames = Math.floor(sim.end * cam.hz);
  const occluded = {
    worker: sim.people[Math.floor(rng() * sim.people.length)]?.id ?? "",
    from: Math.floor(uniform(rng, 0.25, 0.75) * frames),
    length: 4 + Math.floor(rng() * 4),
  };
  const samples: PositionSample[] = [];
  for (let k = 0; k <= frames; k += 1) {
    const t = Math.max(0, Math.min(sim.end, k / cam.hz + uniform(rng, -cam.jitter, cam.jitter)));
    for (const person of sim.people) {
      const lost = chance(rng, cam.dropChance);
      const dx = clippedNormal(rng, 0, cam.noise, -3 * cam.noise, 3 * cam.noise);
      const dz = clippedNormal(rng, 0, cam.noise, -3 * cam.noise, 3 * cam.noise);
      const hidden = person.id === occluded.worker && k >= occluded.from && k < occluded.from + occluded.length;
      if (lost || hidden) continue;
      const p = positionAt(person, sim.segments[person.id] ?? [], t);
      samples.push({ type: "pos", t: r3(t), workerId: person.id, x: r3(p.x + bias.x + dx), z: r3(p.z + bias.z + dz) });
    }
  }
  return samples;
}
