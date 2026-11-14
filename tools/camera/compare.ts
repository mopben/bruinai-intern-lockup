/**
 * Scores a positions.jsonl from the tracker against the fixture it was
 * filmed from (synthetic video): per worker mean / 95th percentile / worst
 * floor error in cm, and the share of 10 Hz frames that had a position.
 *
 *   npx tsx tools/camera/compare.ts <tracked positions.jsonl> <fixture-dir>
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parsePositions, unwrap } from "../../src/inputs/parse";
import { at, loadFixture, tracksByWorker } from "./fixture";

export interface WorkerScore {
  readonly workerId: string;
  readonly samples: number;
  readonly frames: number;
  readonly lockedShare: number;
  readonly meanCm: number;
  readonly p95Cm: number;
  readonly worstCm: number;
  readonly worstAt: number;
}

export function score(trackedText: string, fixtureDir: string, hz = 10): readonly WorkerScore[] {
  const tracked = unwrap(parsePositions(trackedText, "tracked positions.jsonl")).samples;
  const run = loadFixture(fixtureDir);
  const truth = tracksByWorker(run.samples);
  return run.kitchen.layout.workers.map((w) => {
    const track = truth.get(w.id) ?? [];
    const first = track[0]?.t ?? 0;
    const last = track[track.length - 1]?.t ?? 0;
    const frames = Math.floor(last * hz) - Math.ceil(first * hz) + 1;
    const errs = tracked
      .filter((s) => s.workerId === w.id)
      .flatMap((s) => {
        const p = at(track, s.t);
        return p ? [{ t: s.t, cm: Math.hypot(s.x - p.x, s.z - p.z) * 100 }] : [];
      });
    const sorted = errs.map((e) => e.cm).sort((a, b) => a - b);
    const worst = errs.reduce((m, e) => (e.cm > m.cm ? e : m), { t: 0, cm: 0 });
    return {
      workerId: w.id,
      samples: errs.length,
      frames,
      lockedShare: errs.length / Math.max(1, frames),
      meanCm: sorted.reduce((s, x) => s + x, 0) / Math.max(1, sorted.length),
      p95Cm: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
      worstCm: worst.cm,
      worstAt: worst.t,
    };
  });
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const [file, dir] = process.argv.slice(2);
  if (!file || !dir) {
    process.stderr.write("Usage: compare.ts <tracked positions.jsonl> <fixture-dir>\n");
    process.exit(1);
  }
  const rows = score(readFileSync(file, "utf8"), resolve(dir));
  for (const r of rows) {
    process.stdout.write(
      `${r.workerId.padEnd(7)} locked ${(r.lockedShare * 100).toFixed(1)}% of ${r.frames} frames, mean ${r.meanCm.toFixed(1)} cm, p95 ${r.p95Cm.toFixed(1)} cm, worst ${r.worstCm.toFixed(1)} cm at t=${r.worstAt.toFixed(1)} s\n`,
    );
  }
  const all = rows.reduce((s, r) => s + r.meanCm * r.samples, 0) / rows.reduce((s, r) => s + r.samples, 0);
  process.stdout.write(`overall mean ${all.toFixed(1)} cm, worst ${Math.max(...rows.map((r) => r.worstCm)).toFixed(1)} cm\n`);
}
