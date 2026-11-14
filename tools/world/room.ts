/**
 * The staged counter as it really is (ground truth for the world generator).
 *
 * Floor about 4.5 m x 3.5 m. Back wall along z = 0, left wall along x = 0.
 * The work line runs along the back wall: Order (till), Make (espresso), Finish.
 * Workers stand in front of it (larger z), facing the wall.
 *
 * The scan (scan.ts) is a noisy measurement of this room. The model only ever
 * sees the scan and the logs, never these numbers.
 */
import type { BoxSide, ItemRole } from "../../src/core/types";
import type { Bounds, Rect } from "./geometry";

export type BoxKey = "order" | "make" | "finish" | "fridge" | "pickup" | "sink" | "stool" | "queue";

export interface TrueBox {
  readonly key: BoxKey;
  /** What RoomPlan would call it. */
  readonly category: string;
  readonly confidence: "low" | "medium" | "high";
  readonly rect: Rect;
  readonly h: number;
  /** The owner's corrections (setup.json). */
  readonly name: string;
  readonly role: ItemRole;
  readonly locked: boolean;
  readonly standSide: BoxSide;
  /** Does it stop people walking through it in the real room? */
  readonly blocks: boolean;
}

export interface TrueWall {
  readonly key: string;
  readonly rect: Rect;
  readonly h: number;
}

export interface Room {
  readonly bounds: Bounds;
  readonly walls: readonly TrueWall[];
  readonly boxes: readonly TrueBox[];
}

const HALF_PI = Math.PI / 2;

const rect = (cx: number, cz: number, w: number, d: number, yaw = 0): Rect => ({ cx, cz, hw: w / 2, hd: d / 2, yaw });

const box = (
  key: BoxKey,
  category: string,
  r: Rect,
  h: number,
  owner: Pick<TrueBox, "name" | "role" | "locked">,
  extra: Partial<Pick<TrueBox, "confidence" | "blocks" | "standSide">> = {},
): TrueBox => ({
  key,
  category,
  rect: r,
  h,
  ...owner,
  confidence: extra.confidence ?? "high",
  blocks: extra.blocks ?? true,
  standSide: extra.standSide ?? "front",
});

/** Fridge against the left wall, near the front: about 2 m walk from Make. */
export const FRIDGE_FAR: Rect = rect(0.34, 2.66, 0.6, 0.6, HALF_PI);
/** Fridge as a back-bar fridge right behind the Make worker, door facing the counter: well under 1 m walk. */
export const FRIDGE_CLOSE: Rect = rect(1.8, 1.97, 0.6, 0.6, Math.PI);

export function stagedCounter(fridge: Rect = FRIDGE_FAR): Room {
  return {
    bounds: { minX: 0, maxX: 4.5, minZ: 0, maxZ: 3.5 },
    walls: [
      { key: "back", rect: rect(2.25, -0.05, 4.5, 0.1, 0), h: 2.44 },
      { key: "left", rect: rect(-0.05, 1.75, 3.5, 0.1, HALF_PI), h: 2.44 },
    ],
    boxes: [
      box("order", "table", rect(1.15, 0.33, 0.74, 0.6), 0.91, { name: "Order (till)", role: "station", locked: false }),
      box("make", "storage", rect(2.05, 0.33, 0.72, 0.62), 0.93, {
        name: "Espresso machine",
        role: "station",
        locked: true,
      }),
      box("finish", "table", rect(2.95, 0.33, 0.8, 0.6), 0.9, { name: "Finish", role: "station", locked: false }),
      box("fridge", "refrigerator", fridge, 0.86, { name: "Milk fridge", role: "storage", locked: false }),
      box("pickup", "table", rect(4.2, 1.9, 1.0, 0.5, -HALF_PI), 0.76, {
        name: "Pickup",
        role: "pickup",
        locked: false,
      }),
      box("sink", "sink", rect(3.95, 0.3, 0.62, 0.55), 0.92, { name: "Sink", role: "fixture", locked: true }),
      box(
        "stool",
        "chair",
        rect(4.12, 3.18, 0.42, 0.4, 0.3),
        0.66,
        { name: "Stool (scan noise)", role: "ignore", locked: false },
        { confidence: "low" },
      ),
      box(
        "queue",
        "unknown",
        rect(2.35, 3.05, 1.3, 0.55),
        0.02,
        { name: "Queue", role: "queue", locked: false },
        { confidence: "medium", blocks: false },
      ),
    ],
  };
}

export function boxByKey(room: Room, key: BoxKey): TrueBox {
  const found = room.boxes.find((b) => b.key === key);
  if (!found) throw new Error(`Room has no box "${key}"`);
  return found;
}
