/**
 * Builders for small hand-made kitchens, used by the core tests.
 * Not part of the public API.
 */
import type { Calibration } from "./calibrate";
import type { BoxSide, ItemRole, Layout, MenuItem, PositionSample, Scan, ScanWall, Setup, TapEvent, Vec2, WorkerDef } from "./types";
import type { RunTrace } from "./trace";
import { polylineLength } from "./geometry";

export interface KitBox {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly w?: number;
  readonly d?: number;
  readonly yaw?: number;
  readonly role: ItemRole;
  readonly standSide?: BoxSide;
  readonly locked?: boolean;
}

export interface KitSpec {
  readonly boxes: readonly KitBox[];
  readonly walls?: readonly ScanWall[];
  readonly menu: readonly MenuItem[];
  readonly workers: readonly WorkerDef[];
  readonly orders?: readonly { readonly orderId: string; readonly itemId: string; readonly t: number }[];
  readonly pickupId?: string;
}

export function kitScan(spec: KitSpec): Scan {
  return {
    format: "dryrun.scan",
    version: 1,
    units: "m",
    capturedAt: "2026-11-14T00:00:00Z",
    source: "synthetic",
    walls: spec.walls ?? [],
    boxes: spec.boxes.map((b) => ({
      id: b.id,
      category: "table",
      center: { x: b.x, y: 0.45, z: b.z },
      size: { w: b.w ?? 1, h: 0.9, d: b.d ?? 1 },
      yaw: b.yaw ?? 0,
    })),
  };
}

export function kitSetup(spec: KitSpec): Setup {
  const pickup = spec.pickupId ?? spec.boxes.find((b) => b.role === "pickup")?.id ?? "pickup";
  return {
    format: "dryrun.setup",
    version: 1,
    items: spec.boxes.map((b) => ({
      boxId: b.id,
      name: b.id,
      role: b.role,
      locked: b.locked ?? false,
      ...(b.standSide ? { standSide: b.standSide } : {}),
    })),
    menu: spec.menu,
    pickupId: pickup,
    schedule: { orders: spec.orders ?? [] },
  };
}

export function kitLayout(spec: KitSpec): Layout {
  return { format: "dryrun.layout", version: 1, placements: {}, workers: spec.workers };
}

export function worker(id: string, stationId: string): WorkerDef {
  return { id, name: id, color: "#ff0000", stationId };
}

export function evenOrders(n: number, gap: number, itemId = "latte", start = 0): readonly { orderId: string; itemId: string; t: number }[] {
  return Array.from({ length: n }, (_, i) => ({ orderId: `o${i + 1}`, itemId, t: start + i * gap }));
}

export function fixedCalibration(samples: Record<string, readonly number[]>, speed = 1.2): Calibration {
  return {
    walkSpeedMps: speed,
    walkSpeedAssumed: false,
    walkSpeedSamples: 100,
    workSamples: samples,
    sampleCount: Object.values(samples).flat().length,
    clampedCount: 0,
    orderIds: [],
    warnings: [],
  };
}

/**
 * A small café counter like the staged demo: Order, Make (fetches from a fridge), Finish,
 * a sink, a pickup, two walls. `fridge` moves the fridge; `makeWorkers` staffs Make.
 */
export function cafeKit(fridge: { x: number; z: number } = { x: -1.8, z: 1.2 }, makeWorkers = 1): KitSpec {
  const wall = (id: string, x: number, z: number, w: number, yaw: number): ScanWall => ({
    id,
    center: { x, y: 1.2, z },
    size: { w, h: 2.4, d: 0.1 },
    yaw,
  });
  return {
    boxes: [
      { id: "order", x: -1.5, z: -1.2, w: 1, d: 0.6, role: "station" },
      { id: "make", x: 0, z: -1.2, w: 1, d: 0.6, role: "station", locked: true },
      { id: "sink", x: 0.75, z: -1.2, w: 0.5, d: 0.6, role: "fixture", locked: true },
      { id: "finish", x: 1.5, z: -1.2, w: 1, d: 0.6, role: "station" },
      { id: "fridge", x: fridge.x, z: fridge.z, w: 0.6, d: 0.6, role: "storage", standSide: "back" },
      { id: "pickup", x: 1.5, z: 1.2, w: 0.8, d: 0.5, role: "pickup", standSide: "back" },
      { id: "chair", x: 0, z: 0.4, w: 0.4, d: 0.4, role: "ignore" },
    ],
    walls: [wall("back", 0, -1.6, 4.5, 0), wall("left", -2.3, 0, 3.5, Math.PI / 2)],
    menu: [
      {
        id: "latte",
        name: "Latte",
        steps: [{ stationId: "order" }, { stationId: "make", fetchFrom: ["fridge"] }, { stationId: "finish" }],
      },
    ],
    workers: [
      worker("red", "order"),
      ...Array.from({ length: makeWorkers }, (_, i) => worker(i === 0 ? "blue" : `blue${i + 1}`, "make")),
      worker("yellow", "finish"),
    ],
    orders: evenOrders(10, 6),
  };
}

/** Tap log a recorded run would have, from a (simulated) trace. */
export function traceToTaps(trace: RunTrace): readonly TapEvent[] {
  const events: TapEvent[] = [];
  for (const o of trace.orders) {
    events.push({ type: "order", t: o.releasedAt, orderId: o.orderId, itemId: o.itemId });
    for (const s of o.steps) {
      if (s.tapAt !== null) {
        events.push({ type: "done", t: s.tapAt, orderId: o.orderId, step: s.step, stationId: s.stationId, ...(s.workerId ? { workerId: s.workerId } : {}) });
      }
    }
  }
  events.push({ type: "end", t: trace.endT });
  return [...events].sort((a, b) => a.t - b.t);
}

function pointAlong(path: readonly Vec2[], f: number): Vec2 {
  const total = polylineLength(path);
  let left = total * f;
  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1] as Vec2;
    const b = path[i] as Vec2;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (left <= len && len > 0) return { x: a.x + ((b.x - a.x) * left) / len, z: a.z + ((b.z - a.z) * left) / len };
    left -= len;
  }
  return path[path.length - 1] ?? { x: 0, z: 0 };
}

/** Position log a camera would give, from a trace's movement segments, at `hz`. */
export function traceToPositions(trace: RunTrace, home: ReadonlyMap<string, Vec2>, hz = 10): readonly PositionSample[] {
  const out: PositionSample[] = [];
  for (const [workerId, at] of home) {
    const segs = trace.movements.filter((m) => m.workerId === workerId);
    for (let i = 0; i <= trace.endT * hz; i += 1) {
      const t = i / hz;
      const seg = segs.find((m) => m.t0 <= t && t < m.t1);
      const p = seg && seg.path.length > 1 ? pointAlong(seg.path, (t - seg.t0) / (seg.t1 - seg.t0)) : (seg?.path[0] ?? at);
      out.push({ type: "pos", t, workerId, x: p.x, z: p.z });
    }
  }
  return out;
}
