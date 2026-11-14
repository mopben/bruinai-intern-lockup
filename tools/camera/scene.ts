/**
 * What the synthetic camera sees: the kitchen's boxes and walls as shaded
 * prisms, a pendant lamp that briefly hides hats, a small red mug (a
 * distractor below the minimum hat size), and the workers.
 *
 * The true camera pose and the true hat heights live here. The tracker never
 * reads them; they are only used to render frames and to score the result.
 */
import type { Vec2, WorkerDef } from "../../src/core/types";
import { hexToRgb } from "../../src/camera/color";
import type { CameraPose } from "../../src/camera/pinhole";
import { kitchenView, type Kitchen, type KitchenView } from "../../src/camera/kitchen";
import type { Rgb } from "./raster";

export interface Prism {
  readonly kind: "prism";
  readonly base: readonly Vec2[];
  readonly y0: number;
  readonly y1: number;
  readonly color: Rgb;
}

export interface Person {
  readonly kind: "person";
  readonly id: string;
  readonly p: Vec2;
  /** True height of the middle of the hat, metres. */
  readonly hatY: number;
  readonly hat: Rgb;
  readonly shirt: Rgb;
  /** An arm raised over part of the hat (occlusion). */
  readonly armUp: boolean;
}

export type Drawable = Prism | Person;

/** A plausible high tripod: 2.8 m up, 1.5 m in front of the counter area, tilted down. */
export const TRUE_POSE: CameraPose = {
  position: { x: 2.3, y: 2.8, z: 5.0 },
  target: { x: 2.2, y: 0.6, z: 1.4 },
  focalPx: 950,
  width: 1280,
  height: 720,
  // A real lens is not perfectly centred; the tracker does not know this.
  cx: 643,
  cy: 357,
};

/** True hat heights. The operator's default is 1.65 m for everyone. */
export const TRUE_HAT_Y: Readonly<Record<string, number>> = { red: 1.63, blue: 1.7, yellow: 1.66, green: 1.68 };

const ROLE_COLOURS: Readonly<Record<string, Rgb>> = {
  station: [176, 178, 182], // steel counters
  storage: [214, 214, 208], // white fridge
  pickup: [158, 120, 82], // wooden shelf
  queue: [205, 175, 120], // tape on the floor
  fixture: [150, 152, 156],
};

const SHIRTS: readonly Rgb[] = [[52, 52, 58], [120, 96, 78], [230, 228, 222], [70, 66, 62]];

export interface StaticScene {
  readonly view: KitchenView;
  readonly prisms: readonly Prism[];
}

const square = (c: Vec2, half: number): Vec2[] => [
  { x: c.x - half, z: c.z - half },
  { x: c.x + half, z: c.z - half },
  { x: c.x + half, z: c.z + half },
  { x: c.x - half, z: c.z + half },
];

export function buildStaticScene(k: Kitchen): StaticScene {
  const v = kitchenView(k);
  if (!v.ok) throw new Error(v.error);
  const boxes = v.value.boxes.map(
    (b): Prism => ({ kind: "prism", base: b.footprint, y0: 0, y1: b.height, color: ROLE_COLOURS[b.role] ?? [160, 160, 160] }),
  );
  const walls = v.value.walls.map((fp): Prism => ({ kind: "prism", base: fp, y0: 0, y1: 2.4, color: [226, 216, 196] }));
  const order = v.value.boxes.find((b) => b.role === "station");
  const mug: Prism[] = order
    ? [{ kind: "prism", base: square({ x: order.footprint[0]!.x + 0.15, z: order.footprint[0]!.z + 0.2 }, 0.04), y0: order.height, y1: order.height + 0.1, color: [225, 45, 40] }]
    : [];
  // On the sight line to the fridge trip, clear of the stations: hides a hat for a moment.
  const lamp: Prism = { kind: "prism", base: square({ x: 1.58, z: 3.16 }, 0.1), y0: 2.0, y1: 2.15, color: [236, 232, 220] };
  return { view: v.value, prisms: [...walls, ...boxes, ...mug, lamp] };
}

export function person(w: WorkerDef, index: number, p: Vec2, t: number): Person {
  const rgb = hexToRgb(w.color) ?? { r: 128, g: 128, b: 128 };
  // Each person raises an arm over their hat for 0.4 s every 17 s, staggered.
  const phase = (t + index * 5.3) % 17;
  return {
    kind: "person",
    id: w.id,
    p,
    hatY: TRUE_HAT_Y[w.id] ?? 1.65,
    hat: [rgb.r, rgb.g, rgb.b],
    shirt: SHIRTS[index % SHIRTS.length]!,
    armUp: phase < 0.4,
  };
}
