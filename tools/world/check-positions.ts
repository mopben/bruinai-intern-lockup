/**
 * positions.jsonl: known workers, time order, plausible speeds, inside the room.
 */
import type { Layout, PositionSample, PositionsHeader, Scan } from "../../src/core/types";
import type { Lined, Sink } from "./checks";

const F = "positions.jsonl";
/** Faster than this between two samples is a tracking jump, not a person. */
const JUMP_SPEED = 4;
const ROOM_MARGIN = 0.5;

function roomExtent(scan: Scan): { minX: number; maxX: number; minZ: number; maxZ: number } | undefined {
  const pts = [...scan.walls, ...scan.boxes].flatMap((b) => {
    const r = Math.max(b.size.w, b.size.d) / 2;
    return [
      { x: b.center.x - r, z: b.center.z - r },
      { x: b.center.x + r, z: b.center.z + r },
    ];
  });
  if (pts.length === 0) return undefined;
  return {
    minX: Math.min(...pts.map((p) => p.x)) - ROOM_MARGIN,
    maxX: Math.max(...pts.map((p) => p.x)) + ROOM_MARGIN,
    minZ: Math.min(...pts.map((p) => p.z)) - ROOM_MARGIN,
    maxZ: Math.max(...pts.map((p) => p.z)) + ROOM_MARGIN,
  };
}

export function checkPositions(
  header: PositionsHeader | undefined,
  samples: readonly Lined<PositionSample>[],
  scan: Scan | undefined,
  layout: Layout | undefined,
  s: Sink,
): { workers: number; samples: number } {
  const known = new Set((layout?.workers ?? []).map((w) => w.id));
  const unknown = new Map<string, number>();
  samples.forEach((p, i) => {
    const prev = samples[i - 1];
    if (prev && p.value.t < prev.value.t - 1e-9) {
      s.warn(F, `t=${p.value.t} is earlier than the line above (t=${prev.value.t}). Lines are read in time order anyway.`, p.line);
    }
    if (layout && !known.has(p.value.workerId) && !unknown.has(p.value.workerId)) unknown.set(p.value.workerId, p.line);
  });
  for (const [id, line] of unknown) {
    s.error(F, `worker "${id}" is not in layout.json "workers". Use the same ids in both files (known: ${[...known].join(", ") || "none"}).`, line);
  }
  const byWorker = new Map<string, Lined<PositionSample>[]>();
  for (const p of [...samples].sort((a, b) => a.value.t - b.value.t)) {
    const track = byWorker.get(p.value.workerId);
    if (track) track.push(p);
    else byWorker.set(p.value.workerId, [p]);
  }
  for (const w of layout?.workers ?? []) {
    if (!byWorker.has(w.id)) s.warn(F, `worker "${w.id}" (${w.name}) has no position samples. Their dot will not move.`);
  }
  for (const [id, track] of byWorker) {
    const jumps = track.filter((p, i) => {
      const q = track[i - 1];
      if (!q) return false;
      const dt = p.value.t - q.value.t;
      return dt > 0 && Math.hypot(p.value.x - q.value.x, p.value.z - q.value.z) / dt > JUMP_SPEED;
    });
    const first = jumps[0];
    if (first) {
      s.warn(F, `worker "${id}" jumps faster than ${JUMP_SPEED} m/s ${jumps.length} time${jumps.length > 1 ? "s" : ""} (first here). Check the tracker or the calibration.`, first.line);
    }
    if (header && track.length > 10) {
      const span = (track[track.length - 1] as Lined<PositionSample>).value.t - (track[0] as Lined<PositionSample>).value.t;
      const rate = span > 0 ? (track.length - 1) / span : 0;
      if (rate < header.hz * 0.5 || rate > header.hz * 1.5) {
        s.warn(F, `worker "${id}" has about ${rate.toFixed(1)} samples per second, but the header says hz=${header.hz}.`);
      }
    }
  }
  const box = scan ? roomExtent(scan) : undefined;
  if (box) {
    const outside = samples.filter((p) => p.value.x < box.minX || p.value.x > box.maxX || p.value.z < box.minZ || p.value.z > box.maxZ);
    const first = outside[0];
    if (first) {
      s.warn(F, `${outside.length} sample${outside.length > 1 ? "s are" : " is"} well outside the scanned room (first here: x=${first.value.x}, z=${first.value.z}). Is the camera calibrated to the scan's floor frame?`, first.line);
    }
  }
  return { workers: byWorker.size, samples: samples.length };
}
