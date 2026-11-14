/**
 * Loads a fixture run for the synthetic camera and gives each worker's true
 * floor position at any time (linear interpolation of positions.jsonl).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PositionSample, Vec2 } from "../../src/core/types";
import type { Kitchen } from "../../src/camera/kitchen";
import { parseLayout, parsePositions, parseScan, parseSetup, unwrap } from "../../src/inputs/parse";

export interface FixtureRun {
  readonly kitchen: Kitchen;
  readonly samples: readonly PositionSample[];
  readonly startedAt: string;
  readonly duration: number;
}

export function loadFixture(dir: string): FixtureRun {
  const read = (f: string) => readFileSync(join(dir, f), "utf8");
  const positions = unwrap(parsePositions(read("positions.jsonl")));
  const samples = positions.samples;
  return {
    kitchen: {
      scan: unwrap(parseScan(read("scan.json"))),
      setup: unwrap(parseSetup(read("setup.json"))),
      layout: unwrap(parseLayout(read("layout.json"))),
    },
    samples,
    startedAt: positions.header.startedAt,
    duration: samples.length > 0 ? samples[samples.length - 1]!.t : 0,
  };
}

export type Track = readonly { readonly t: number; readonly p: Vec2 }[];

export function tracksByWorker(samples: readonly PositionSample[]): ReadonlyMap<string, Track> {
  const m = new Map<string, { t: number; p: Vec2 }[]>();
  for (const s of samples) m.set(s.workerId, [...(m.get(s.workerId) ?? []), { t: s.t, p: { x: s.x, z: s.z } }]);
  return m;
}

/** Position at t, or undefined outside the track's time span. */
export function at(track: Track, t: number): Vec2 | undefined {
  if (track.length === 0 || t < track[0]!.t || t > track[track.length - 1]!.t) return undefined;
  let lo = 0;
  let hi = track.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (track[mid]!.t <= t) lo = mid;
    else hi = mid;
  }
  const a = track[lo]!;
  const b = track[hi]!;
  const u = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
  return { x: a.p.x + u * (b.p.x - a.p.x), z: a.p.z + u * (b.p.z - a.p.z) };
}
