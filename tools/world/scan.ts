/**
 * A scan of the staged counter, shaped like our RoomPlan export: scanner
 * categories, sizes and positions off by a centimetre or two, yaw off by a
 * degree or two, objects in no particular order, UUID identifiers.
 *
 * It is marked source "synthetic": it imitates a scan but nobody scanned it.
 */
import { FORMAT_VERSION, SCAN_FORMAT, type Scan, type ScanBox, type ScanWall } from "../../src/core/types";
import type { BoxKey, Room } from "./room";
import { clippedNormal, normal, uuid, type Rng } from "./rng";

const DEG = Math.PI / 180;
const r4 = (v: number): number => Math.round(v * 10000) / 10000;

export interface ScannedRoom {
  readonly scan: Scan;
  /** Box key in the true room -> id in the scan. */
  readonly ids: Readonly<Record<BoxKey, string>>;
}

/** Deterministic shuffle (Fisher-Yates on a copy). */
function shuffled<T>(items: readonly T[], rng: Rng): readonly T[] {
  return items.reduce<T[]>((acc, item, i) => {
    const j = Math.floor(rng() * (i + 1));
    const copy = [...acc, item];
    const tmp = copy[j] as T;
    copy[j] = copy[i] as T;
    copy[i] = tmp;
    return copy;
  }, []);
}

export function scanRoom(room: Room, rng: Rng, capturedAt: string): ScannedRoom {
  // Walls carry a nominal thickness (size.d must be more than 0 in our format), centred in the wall.
  const walls: readonly ScanWall[] = room.walls.map((w) => ({
    id: uuid(rng),
    center: { x: r4(w.rect.cx + normal(rng, 0, 0.008)), y: r4(w.h / 2 + normal(rng, 0, 0.01)), z: r4(w.rect.cz + normal(rng, 0, 0.008)) },
    size: {
      w: r4(w.rect.hw * 2 * (1 + normal(rng, 0, 0.008))),
      h: r4(w.h * (1 + normal(rng, 0, 0.006))),
      d: r4(w.rect.hd * 2 * (1 + normal(rng, 0, 0.05))),
    },
    yaw: r4(w.rect.yaw + clippedNormal(rng, 0, 0.4 * DEG, -0.8 * DEG, 0.8 * DEG)),
  }));
  const measured = room.boxes.map((b) => {
    const h = b.h * (1 + normal(rng, 0, 0.012));
    const box: ScanBox = {
      id: uuid(rng),
      category: b.category,
      center: {
        x: r4(b.rect.cx + clippedNormal(rng, 0, 0.012, -0.03, 0.03)),
        y: r4(h / 2 + normal(rng, 0, 0.004)),
        z: r4(b.rect.cz + clippedNormal(rng, 0, 0.012, -0.03, 0.03)),
      },
      size: {
        w: r4(b.rect.hw * 2 * (1 + clippedNormal(rng, 0, 0.015, -0.04, 0.04))),
        h: r4(Math.max(0.012, h)),
        d: r4(b.rect.hd * 2 * (1 + clippedNormal(rng, 0, 0.015, -0.04, 0.04))),
      },
      yaw: r4(b.rect.yaw + clippedNormal(rng, 0, 1.1 * DEG, -2 * DEG, 2 * DEG)),
      confidence: b.confidence,
    };
    return { key: b.key, box };
  });
  const ordered = shuffled(measured, rng);
  return {
    scan: {
      format: SCAN_FORMAT,
      version: FORMAT_VERSION,
      units: "m",
      capturedAt,
      source: "synthetic",
      walls,
      boxes: ordered.map((m) => m.box),
    },
    ids: Object.fromEntries(measured.map((m) => [m.key, m.box.id])) as Record<BoxKey, string>,
  };
}
