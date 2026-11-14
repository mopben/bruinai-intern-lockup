/**
 * Whole walking trips found in the position log.
 *
 * A trip is an excursion from a worker's home stand point (their station's stand
 * point in the recorded layout): the worker goes further than TRIP_EXCURSION_M
 * from home and comes back within TRIP_HOME_M. It starts at the last sample
 * within TRIP_HOME_M before the excursion and ends at the first one after it.
 *
 * Each trip is matched to the round trip the protocol says it must be: one of
 * the fetch or carry legs from that worker's station whose far stand point the
 * worker came within TRIP_MATCH_M of. If several were reached (a carry walks
 * past a fridge on its way), the longest is taken. Its modelled distance is the
 * leg's round trip minus the parts inside the home circle at either end
 * (straight-line distance of the start and end samples from home).
 */
import type { PositionSample, Vec2 } from "./types";
import type { World } from "./world";
import { distance } from "./geometry";
import { planItems } from "./plan";
import type { LegKind } from "./walking";

/** Further than this from home counts as away. */
export const TRIP_EXCURSION_M = 0.5;
/** Within this of home counts as at home (position noise is a few cm). */
export const TRIP_HOME_M = 0.25;
/** A trip reached a stand point when it came within this of it. */
export const TRIP_MATCH_M = 0.5;

export interface Trip {
  readonly workerId: string;
  readonly kind: LegKind;
  readonly targetId: string;
  /** `${kind}:${targetId}`: trips of one group are the same walk. */
  readonly group: string;
  readonly t0: number;
  readonly t1: number;
  /** Modelled walking distance covered between t0 and t1. */
  readonly distanceM: number;
  readonly durationS: number;
}

interface Candidate {
  readonly kind: LegKind;
  readonly targetId: string;
  readonly stand: Vec2;
  readonly roundTripM: number;
}

function candidatesFor(world: World, stationId: string): readonly Candidate[] {
  const out = new Map<string, Candidate>();
  for (const plan of planItems(world).values()) {
    for (const s of plan.steps) {
      if (s.stationId !== stationId) continue;
      const legs = [...s.fetchLegs, ...(s.carry.handoff ? [] : [s.carry])];
      for (const l of legs) {
        const stand = world.itemsById.get(l.toId)?.stand;
        if (stand && l.roundTripM > 0) out.set(`${l.kind}:${l.toId}`, { kind: l.kind, targetId: l.toId, stand, roundTripM: l.roundTripM });
      }
    }
  }
  return [...out.values()];
}

function matchTrip(samples: readonly PositionSample[], cands: readonly Candidate[]): Candidate | null {
  let best: Candidate | null = null;
  for (const c of cands) {
    const reached = samples.some((p) => distance({ x: p.x, z: p.z }, c.stand) <= TRIP_MATCH_M);
    if (reached && (best === null || c.roundTripM > best.roundTripM)) best = c;
  }
  return best;
}

function workerTrips(workerId: string, home: Vec2, list: readonly PositionSample[], cands: readonly Candidate[]): Trip[] {
  const d = list.map((p) => distance({ x: p.x, z: p.z }, home));
  const trips: Trip[] = [];
  let i = 0;
  while (i < list.length) {
    if ((d[i] as number) <= TRIP_EXCURSION_M) {
      i += 1;
      continue;
    }
    let j = i;
    while (j < list.length && (d[j] as number) > TRIP_HOME_M) j += 1; // j: first back home
    let s = i - 1;
    while (s >= 0 && (d[s] as number) > TRIP_HOME_M) s -= 1; // s: last at home before
    if (s < 0 || j >= list.length) {
      i = j + 1;
      continue;
    }
    const start = list[s] as PositionSample;
    const end = list[j] as PositionSample;
    const c = matchTrip(list.slice(s, j + 1), cands);
    if (c) {
      const distanceM = c.roundTripM - (d[s] as number) - (d[j] as number);
      trips.push({ workerId, kind: c.kind, targetId: c.targetId, group: `${c.kind}:${c.targetId}`, t0: start.t, t1: end.t, distanceM, durationS: end.t - start.t });
    }
    i = j + 1;
  }
  return trips;
}

/** All matched trips in the position log, for workers of the recorded layout. */
export function detectTrips(world: World, positions: readonly PositionSample[]): readonly Trip[] {
  const out: Trip[] = [];
  for (const w of world.workers) {
    const home = world.itemsById.get(w.stationId)?.stand;
    if (!home) continue;
    const list = positions
      .filter((p) => p.workerId === w.id && Number.isFinite(p.t) && Number.isFinite(p.x) && Number.isFinite(p.z))
      .sort((a, b) => a.t - b.t);
    out.push(...workerTrips(w.id, home, list, candidatesFor(world, w.stationId)));
  }
  return out;
}
