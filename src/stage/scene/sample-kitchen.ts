/**
 * A small embedded kitchen matching "The staged kitchen" in docs/PLAN.md.
 * For the dev harness and tests only; the demo uses fixtures from a scan.
 * Room is about 4.5 m x 3.5 m centred on the origin, back wall at -z, left wall at -x.
 */
import {
  FORMAT_VERSION,
  LAYOUT_FORMAT,
  SCAN_FORMAT,
  SETUP_FORMAT,
  type Layout,
  type Scan,
  type ScanBox,
  type Setup,
} from "../../core/types";

export const SAMPLE_IDS = {
  order: "box-01",
  make: "box-02",
  finish: "box-03",
  fridge: "box-04",
  pickup: "box-05",
  sink: "box-06",
  noise: "box-07",
  queue: "box-08",
} as const;

function box(id: string, category: string, x: number, z: number, w: number, h: number, d: number, yaw = 0): ScanBox {
  return { id, category, center: { x, y: h / 2, z }, size: { w, h, d }, yaw, confidence: "high" };
}

export const sampleScan: Scan = {
  format: SCAN_FORMAT,
  version: FORMAT_VERSION,
  units: "m",
  capturedAt: "2026-11-14T10:00:00Z",
  source: "synthetic",
  walls: [
    { id: "wall-back", center: { x: 0, y: 1.2, z: -1.7 }, size: { w: 4.5, h: 2.4, d: 0.1 }, yaw: 0 },
    { id: "wall-left", center: { x: -2.2, y: 1.2, z: 0 }, size: { w: 3.5, h: 2.4, d: 0.1 }, yaw: Math.PI / 2 },
  ],
  boxes: [
    box(SAMPLE_IDS.order, "table", -1.0, 0.95, 1.1, 0.9, 0.6),
    box(SAMPLE_IDS.make, "storage", 0.35, -1.33, 0.85, 1.0, 0.6),
    box(SAMPLE_IDS.finish, "table", 1.45, -1.33, 1.0, 0.9, 0.6),
    box(SAMPLE_IDS.fridge, "refrigerator", -1.8, -1.28, 0.6, 0.95, 0.65),
    box(SAMPLE_IDS.pickup, "table", 1.55, 0.95, 0.9, 0.9, 0.55),
    box(SAMPLE_IDS.sink, "sink", -0.75, -1.36, 0.75, 0.9, 0.55),
    box(SAMPLE_IDS.noise, "chair", 1.95, -0.2, 0.45, 0.8, 0.45, 0.3),
    box(SAMPLE_IDS.queue, "floor mark", 0.2, 1.4, 1.5, 0.02, 0.55),
  ],
};

export const sampleSetup: Setup = {
  format: SETUP_FORMAT,
  version: FORMAT_VERSION,
  items: [
    { boxId: SAMPLE_IDS.order, name: "Order", role: "station", locked: false, standSide: "back" },
    { boxId: SAMPLE_IDS.make, name: "Make", role: "station", locked: true, standSide: "front" },
    { boxId: SAMPLE_IDS.finish, name: "Finish", role: "station", locked: false, standSide: "front" },
    { boxId: SAMPLE_IDS.fridge, name: "Milk fridge", role: "storage", locked: false, standSide: "front" },
    { boxId: SAMPLE_IDS.pickup, name: "Pickup", role: "pickup", locked: false, standSide: "back" },
    { boxId: SAMPLE_IDS.sink, name: "Sink", role: "fixture", locked: true },
    { boxId: SAMPLE_IDS.noise, name: "Chair", role: "ignore", locked: false },
    { boxId: SAMPLE_IDS.queue, name: "Queue", role: "queue", locked: false },
  ],
  menu: [
    {
      id: "latte",
      name: "Latte",
      steps: [
        { stationId: SAMPLE_IDS.order },
        { stationId: SAMPLE_IDS.make, fetchFrom: [SAMPLE_IDS.fridge] },
        { stationId: SAMPLE_IDS.finish },
      ],
    },
  ],
  pickupId: SAMPLE_IDS.pickup,
  schedule: {
    orders: Array.from({ length: 10 }, (_, i) => ({ orderId: `o${i + 1}`, itemId: "latte", t: 2 + i * 6 })),
  },
};

export const sampleLayout: Layout = {
  format: LAYOUT_FORMAT,
  version: FORMAT_VERSION,
  placements: {},
  workers: [
    { id: "w-red", name: "Red", color: "#e0413a", stationId: SAMPLE_IDS.order },
    { id: "w-blue", name: "Blue", color: "#2f6fd6", stationId: SAMPLE_IDS.make },
    { id: "w-yellow", name: "Yellow", color: "#f4c322", stationId: SAMPLE_IDS.finish },
  ],
};

export const sampleKitchen = { scan: sampleScan, setup: sampleSetup, layout: sampleLayout } as const;
