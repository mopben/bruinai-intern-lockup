/**
 * A compiled simulation model: a world plus a calibration, checked and turned
 * into flat numbers the event loop can use quickly. Build once per layout.
 */
import type { Vec2, WorkerDef } from "./types";
import type { World } from "./world";
import type { Calibration } from "./calibrate";
import { buildPathTable, type PathTable } from "./walking";
import { planItems } from "./plan";
import { menuStations } from "./timeline";

export class SimError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SimError";
  }
}

export interface ModelLeg {
  readonly seconds: number;
  readonly path: readonly Vec2[];
}

export interface ModelStep {
  readonly stationIndex: number;
  readonly stationId: string;
  readonly fetch: readonly ModelLeg[];
  readonly fetchSeconds: number;
  /** One-way carry; seconds 0 for a hand-off. */
  readonly carry: ModelLeg;
}

export interface SimModel {
  readonly world: World;
  readonly table: PathTable;
  readonly stationIds: readonly string[];
  /** Workers per station index. */
  readonly stationWorkers: readonly (readonly WorkerDef[])[];
  readonly items: ReadonlyMap<string, readonly ModelStep[]>;
  readonly maxSteps: number;
  readonly speedMps: number;
  /** Calibrated work samples per station index. */
  readonly samples: readonly (readonly number[])[];
  /** Stable integer per station for random streams (hash of its id). */
  readonly stationKeys: readonly number[];
}

export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Check and compile. Throws SimError for a station with no worker or no work samples. */
export function compileModel(world: World, calibration: Calibration, table?: PathTable): SimModel {
  const t = table ?? buildPathTable(world);
  const stationIds = menuStations(world.menu);
  const speed = calibration.walkSpeedMps;
  if (!(speed > 0)) throw new SimError(`Walking speed must be positive (got ${speed}).`);
  const stationWorkers = stationIds.map((id) => world.workers.filter((w) => w.stationId === id));
  stationWorkers.forEach((ws, i) => {
    const name = world.itemsById.get(stationIds[i] as string)?.name ?? stationIds[i];
    if (ws.length === 0) throw new SimError(`Nobody works at "${name}". Put at least one worker there.`);
  });
  const samples = stationIds.map((id) => calibration.workSamples[id] ?? []);
  samples.forEach((s, i) => {
    const name = world.itemsById.get(stationIds[i] as string)?.name ?? stationIds[i];
    if (s.length === 0) throw new SimError(`No measured work times for "${name}"; record a run where it is used.`);
  });
  const plans = planItems(world, t);
  const items = new Map<string, readonly ModelStep[]>();
  for (const [itemId, plan] of plans) {
    items.set(
      itemId,
      plan.steps.map((s) => ({
        stationIndex: stationIds.indexOf(s.stationId),
        stationId: s.stationId,
        fetch: s.fetchLegs.map((l) => ({ seconds: l.oneWayM / speed, path: l.path })),
        fetchSeconds: s.fetchM / speed,
        carry: { seconds: s.carry.oneWayM / speed, path: s.carry.path },
      })),
    );
  }
  const maxSteps = Math.max(0, ...[...items.values()].map((s) => s.length));
  return { world, table: t, stationIds, stationWorkers, items, maxSteps, speedMps: speed, samples, stationKeys: stationIds.map(hashString) };
}
