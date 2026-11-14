/**
 * Whole walking trips found in the position log, timed from rest to rest.
 *
 * Home is each worker's own resting position: the median of the places they
 * stood still within HOME_SEARCH_M of their station's stand point (two people
 * sharing a station rest either side of it). A trip is an excursion further than
 * TRIP_EXCURSION_M from home. It starts at the last moment the worker was at
 * rest near home before leaving and ends at the first moment at rest near home
 * after coming back, so starting from rest and stopping are inside the trip.
 *
 * "At rest" uses positions smoothed by a 5-sample running median (which leaves
 * clean monotone motion unchanged) and a speed over +-2 samples below
 * REST_SPEED_MPS.
 *
 * Each trip is matched to the round trip the protocol says it must be: one of
 * the fetch or carry legs from that worker's station whose far stand point the
 * worker came within TRIP_MATCH_M of (the longest, if several were reached), and
 * is paired with that leg's full modelled round-trip distance, untrimmed. Any
 * stop/start cost therefore shows up as the fixed overhead of the pace fit.
 * An excursion that leaves home again before coming to rest is dropped.
 */
import type { PositionSample, Vec2 } from "./types";
import type { World } from "./world";
import { distance } from "./geometry";
import { planItems } from "./plan";
import { median } from "./stats";
import type { LegKind } from "./walking";

/** Further than this from home counts as away. */
export const TRIP_EXCURSION_M = 0.5;
/** A rest counts as "at home" within this of home. */
export const TRIP_HOME_M = 0.4;
/** A trip reached a stand point when it came within this of it. */
export const TRIP_MATCH_M = 0.5;
/** Smoothed speed below this is at rest. */
export const REST_SPEED_MPS = 0.12;
/** Home is searched for within this of the station's stand point. */
export const HOME_SEARCH_M = 1.0;
/** Samples further apart than this are not used for a speed. */
const MAX_GAP_S = 1.0;

export interface Trip {
  readonly workerId: string;
  readonly kind: LegKind;
  readonly targetId: string;
  /** `${kind}:${targetId}`: trips of one group are the same walk. */
  readonly group: string;
  readonly t0: number;
  readonly t1: number;
  /** Modelled round-trip distance of the matched leg (full, untrimmed). */
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

/** 5-sample running median of each coordinate. */
export function smoothPositions(list: readonly PositionSample[]): readonly Vec2[] {
  const at = (i: number): PositionSample => list[Math.min(list.length - 1, Math.max(0, i))] as PositionSample;
  return list.map((_, i) => {
    const w = [at(i - 2), at(i - 1), at(i), at(i + 1), at(i + 2)];
    return { x: median(w.map((p) => p.x)), z: median(w.map((p) => p.z)) };
  });
}

/** Per sample: at rest (smoothed speed over +-2 samples below REST_SPEED_MPS). */
export function restFlags(list: readonly PositionSample[], sm: readonly Vec2[]): readonly boolean[] {
  return list.map((_, i) => {
    const a = Math.max(0, i - 2);
    const b = Math.min(list.length - 1, i + 2);
    const dt = (list[b] as PositionSample).t - (list[a] as PositionSample).t;
    if (!(dt > 0) || dt > 4 * MAX_GAP_S) return false;
    return distance(sm[a] as Vec2, sm[b] as Vec2) / dt < REST_SPEED_MPS;
  });
}

/** The worker's own resting position near their station, or the stand point if they never rested there. */
export function restingHome(stand: Vec2, sm: readonly Vec2[], rest: readonly boolean[]): Vec2 {
  const still = sm.filter((p, i) => rest[i] && distance(p, stand) <= HOME_SEARCH_M);
  if (still.length === 0) return stand;
  return { x: median(still.map((p) => p.x)), z: median(still.map((p) => p.z)) };
}

function matchTrip(samples: readonly PositionSample[], cands: readonly Candidate[]): Candidate | null {
  let best: Candidate | null = null;
  for (const c of cands) {
    const reached = samples.some((p) => distance({ x: p.x, z: p.z }, c.stand) <= TRIP_MATCH_M);
    if (reached && (best === null || c.roundTripM > best.roundTripM)) best = c;
  }
  return best;
}

function workerTrips(workerId: string, stand: Vec2, list: readonly PositionSample[], cands: readonly Candidate[]): Trip[] {
  const sm = smoothPositions(list);
  const rest = restFlags(list, sm);
  const home = restingHome(stand, sm, rest);
  const d = sm.map((p) => distance(p, home));
  const restHome = (k: number): boolean => (rest[k] as boolean) && (d[k] as number) <= TRIP_HOME_M;
  const trips: Trip[] = [];
  let floor = -1; // a trip may not start at or before this index (no rest since the last one)
  let i = 0;
  while (i < list.length) {
    if ((d[i] as number) <= TRIP_EXCURSION_M) {
      i += 1;
      continue;
    }
    let s = i - 1;
    while (s > floor && !restHome(s)) s -= 1;
    let back = i;
    while (back < list.length && (d[back] as number) > TRIP_EXCURSION_M) back += 1;
    let e = back;
    while (e < list.length && !restHome(e) && (d[e] as number) <= TRIP_EXCURSION_M) e += 1;
    const ended = e < list.length && restHome(e);
    if (s > floor && ended) {
      const c = matchTrip(list.slice(s, e + 1), cands);
      const t0 = (list[s] as PositionSample).t;
      const t1 = (list[e] as PositionSample).t;
      if (c) trips.push({ workerId, kind: c.kind, targetId: c.targetId, group: `${c.kind}:${c.targetId}`, t0, t1, distanceM: c.roundTripM, durationS: t1 - t0 });
    }
    floor = ended ? e - 1 : e;
    i = Math.max(e, back) + 1;
  }
  return trips;
}

/** All matched trips in the position log, for workers of the recorded layout. */
export function detectTrips(world: World, positions: readonly PositionSample[]): readonly Trip[] {
  const out: Trip[] = [];
  for (const w of world.workers) {
    const stand = world.itemsById.get(w.stationId)?.stand;
    if (!stand) continue;
    const list = positions
      .filter((p) => p.workerId === w.id && Number.isFinite(p.t) && Number.isFinite(p.x) && Number.isFinite(p.z))
      .sort((a, b) => a.t - b.t);
    if (list.length === 0) continue;
    out.push(...workerTrips(w.id, stand, list, candidatesFor(world, w.stationId)));
  }
  return out;
}
