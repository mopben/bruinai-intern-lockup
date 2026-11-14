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
import type { Pace, PaceMethod } from "./pace";
import type { Trip } from "./trips";

export class SimError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SimError";
  }
}

export interface ModelLeg {
  /** One-way walking length; 0 for a hand-off. */
  readonly oneWayM: number;
  readonly path: readonly Vec2[];
}

export interface ModelStep {
  readonly workSeconds?: number;
  readonly stationIndex: number;
  readonly stationId: string;
  readonly fetch: readonly ModelLeg[];
  /** One-way carry; length 0 for a hand-off. */
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
  /** Calibrated pace; each replication may bootstrap its own from `paceTrips`. */
  readonly pace: Pace;
  readonly paceMethod: PaceMethod;
  readonly paceTrips: readonly Trip[];
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
  const pace: Pace = { speedMps: calibration.walkSpeedMps, overheadS: calibration.walkOverheadS };
  if (!(pace.speedMps > 0)) throw new SimError(`Walking speed must be positive (got ${pace.speedMps}).`);
  if (!(pace.overheadS >= 0)) throw new SimError(`Walking overhead must not be negative (got ${pace.overheadS}).`);
  const stationWorkers = stationIds.map((id) => world.workers.filter((w) => w.stationId === id));
  stationWorkers.forEach((ws, i) => {
    const name = world.itemsById.get(stationIds[i] as string)?.name ?? stationIds[i];
    if (ws.length === 0) throw new SimError(`Nobody works at "${name}". Put at least one worker there.`);
  });
  const samples = stationIds.map((id) => calibration.workSamples[id] ?? []);
  samples.forEach((s, i) => {
    const name = world.itemsById.get(stationIds[i] as string)?.name ?? stationIds[i];
    if (s.length === 0 && world.menu.some((m) => m.steps.some((step) => step.stationId === stationIds[i] && step.workSeconds === undefined))) throw new SimError(`No measured work times for "${name}"; record a run where it is used.`);
  });
  const plans = planItems(world, t);
  const items = new Map<string, readonly ModelStep[]>();
  for (const [itemId, plan] of plans) {
    items.set(
      itemId,
      plan.steps.map((s) => ({
        workSeconds: world.menuById.get(itemId)?.steps[s.step]?.workSeconds,
        stationIndex: stationIds.indexOf(s.stationId),
        stationId: s.stationId,
        fetch: s.fetchLegs.map((l) => ({ oneWayM: l.oneWayM, path: l.path })),
        carry: { oneWayM: s.carry.oneWayM, path: s.carry.path },
      })),
    );
  }
  const maxSteps = Math.max(0, ...[...items.values()].map((s) => s.length));
  return { world, table: t, stationIds, stationWorkers, items, maxSteps, pace, paceMethod: calibration.paceMethod, paceTrips: calibration.paceTrips, samples, stationKeys: stationIds.map(hashString) };
}
