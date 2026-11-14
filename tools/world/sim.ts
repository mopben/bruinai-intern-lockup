/**
 * The staged run, simulated person by person at a fixed 20 Hz tick.
 *
 * Each tick: orders whose release time has come appear at Order; every free
 * person looks at their station's counter and starts the oldest item that has
 * arrived (first come, first served). Starting an item plans the person's next
 * moves following the staged-run protocol in src/core/types.ts: fetch round
 * trips, work, a pause, the "done" tap, then a hand pass or a carry and the
 * walk back. Event times are continuous; the tick only decides who starts what.
 */
import { BODY_RADIUS_M, HANDOFF_REACH_M, STAND_OFF_M, type Vec2 } from "../../src/core/types";
import { add, dist, grow, route, scale, sideNormal, sideTangent, standPointOf, type Rect } from "./geometry";
import { makeStay, makeWalk, type Segment } from "./motion";
import { WORLD, type Person } from "./people";
import { boxByKey, type BoxKey, type Room } from "./room";
import { chance, clippedNormal, lognormal, uniform, type Rng } from "./rng";

export const TICK_S = 0.05;
const MAX_RUN_S = 300;

export type StationKey = "order" | "make" | "finish";

export interface StepSpec {
  readonly station: StationKey;
  readonly fetch: readonly BoxKey[];
}

/** The one menu item: Order, then Make (milk from the fridge), then Finish. */
export const LATTE_STEPS: readonly StepSpec[] = [
  { station: "order", fetch: [] },
  { station: "make", fetch: ["fridge"] },
  { station: "finish", fetch: [] },
];

export interface Assignment {
  readonly person: Person;
  readonly station: StationKey;
}

export interface ScheduledOrder {
  readonly orderId: string;
  readonly t: number;
}

export interface DoneRecord {
  readonly t: number;
  readonly orderId: string;
  readonly step: number;
  readonly station: StationKey;
  readonly workerId: string;
}

export interface SimResult {
  readonly end: number;
  readonly done: readonly DoneRecord[];
  readonly delivered: Readonly<Record<string, number>>;
  readonly segments: Readonly<Record<string, readonly Segment[]>>;
  readonly people: readonly Person[];
  /** Most items waiting (arrived, not started) at each station at any tick. */
  readonly maxQueue: Readonly<Record<StationKey, number>>;
  /** Walking per order from the true room, metres (fetch and carry round trips). */
  readonly walkedMetres: number;
}

interface Waiting {
  readonly orderId: string;
  readonly step: number;
  readonly readyAt: number;
}

interface WorkerState {
  readonly person: Person;
  readonly station: StationKey;
  readonly home: Vec2;
  readonly freeAt: number;
  readonly segments: readonly Segment[];
}

interface Ctx {
  readonly room: Room;
  readonly obstacles: readonly Rect[];
  readonly rng: Rng;
}

const STATIONS: readonly StationKey[] = ["order", "make", "finish"];

function stand(room: Room, key: BoxKey): Vec2 {
  const b = boxByKey(room, key);
  return standPointOf(b.rect, b.standSide, STAND_OFF_M);
}

function homes(room: Room, crew: readonly Assignment[]): readonly Vec2[] {
  return crew.map((a) => {
    const mates = crew.filter((c) => c.station === a.station);
    const slot = mates.indexOf(a);
    const b = boxByKey(room, a.station);
    const along = mates.length === 1 ? 0 : (slot - (mates.length - 1) / 2) * 0.56;
    const tangent = sideTangent(b.rect, b.standSide);
    const normal = sideNormal(b.rect, b.standSide);
    return add(add(stand(room, a.station), scale(tangent, along + a.person.habit.along)), scale(normal, a.person.habit.out));
  });
}

function leanToward(room: Room, key: BoxKey, by: number): Vec2 {
  const b = boxByKey(room, key);
  return scale(sideNormal(b.rect, b.standSide), -by);
}

interface Plan {
  readonly segments: readonly Segment[];
  readonly freeAt: number;
  readonly done: DoneRecord;
  readonly next: { readonly step: number; readonly readyAt: number } | { readonly deliveredAt: number };
  readonly walked: number;
}

/** Walk there, do something for `dwell` seconds, walk back. */
function roundTrip(ctx: Ctx, w: WorkerState, to: Vec2, t0: number, dwell: number, lean: Vec2): readonly Segment[] {
  const out = makeWalk(w.person, route(w.home, to, ctx.obstacles, ctx.room.bounds), t0, uniform(ctx.rng, 0.95, 1.05));
  const stay = makeStay(to, out.t1, out.t1 + dwell, lean);
  const back = makeWalk(w.person, route(to, w.home, ctx.obstacles, ctx.room.bounds), stay.t1, uniform(ctx.rng, 0.94, 1.03));
  return [out, stay, back];
}

function planStep(ctx: Ctx, w: WorkerState, item: Waiting, now: number): Plan {
  const { rng, room } = ctx;
  const p = w.person;
  const spec = LATTE_STEPS[item.step];
  if (!spec) throw new Error(`Order ${item.orderId} has no step ${item.step}`);
  const noticed = now + uniform(rng, WORLD.notice[0], WORLD.notice[1]);
  let segs: Segment[] = [makeStay(w.home, now, noticed)];
  let t = noticed;
  let walked = 0;
  for (const key of spec.fetch) {
    const target = stand(room, key);
    const trip = roundTrip(ctx, w, target, t, lognormal(rng, WORLD.fridgeHandling.median, WORLD.fridgeHandling.sigma), leanToward(room, key, 0.07));
    segs = [...segs, ...trip];
    walked += trip.reduce((acc, s) => acc + (s.kind === "walk" ? s.length : 0), 0);
    t = (trip[trip.length - 1] as Segment).t1;
  }
  const wt = WORLD.work[spec.station];
  if (!wt) throw new Error(`No work time for station ${spec.station}`);
  const fumble = chance(rng, p.fumbleChance) ? uniform(rng, WORLD.fumbleFactor[0], WORLD.fumbleFactor[1]) : 1;
  const workEnd = t + lognormal(rng, wt.median * p.skill, wt.sigma) * fumble;
  const tapT = workEnd + clippedNormal(rng, p.tapDelay, p.tapDelay * 0.35, 0.15, 1.6);
  segs = [...segs, makeStay(w.home, t, workEnd, leanToward(room, spec.station, 0.06)), makeStay(w.home, workEnd, tapT)];
  const done: DoneRecord = { t: tapT, orderId: item.orderId, step: item.step, station: spec.station, workerId: p.id };

  const last = item.step === LATTE_STEPS.length - 1;
  const nextKey: BoxKey = last ? "pickup" : (LATTE_STEPS[item.step + 1] as StepSpec).station;
  const from = stand(room, spec.station);
  const to = stand(room, nextKey);
  const settle = (readyAt: number): Plan["next"] => (last ? { deliveredAt: readyAt } : { step: item.step + 1, readyAt });
  if (dist(from, to) <= HANDOFF_REACH_M) {
    const passed = tapT + WORLD.handPass;
    return { segments: [...segs, makeStay(w.home, tapT, passed)], freeAt: passed, done, next: settle(passed), walked };
  }
  // Put the item on the counter beside the receiver, on the side the carrier comes from.
  const nb = boxByKey(room, nextKey);
  const tangent = sideTangent(nb.rect, nb.standSide);
  const side = Math.sign((from.x - to.x) * tangent.x + (from.z - to.z) * tangent.z) || 1;
  const drop = last ? to : add(to, scale(tangent, 0.3 * side));
  const trip = roundTrip(ctx, w, drop, tapT, WORLD.putDown, v2zero());
  const arrive = (trip[1] as Segment).t1;
  walked += trip.reduce((acc, s) => acc + (s.kind === "walk" ? s.length : 0), 0);
  return { segments: [...segs, ...trip], freeAt: (trip[2] as Segment).t1, done, next: settle(arrive), walked };
}

const v2zero = (): Vec2 => ({ x: 0, z: 0 });

/** Replaces the open-ended idle stay at the end of a timeline with one that ends at t. */
function closeIdle(segments: readonly Segment[], t: number): readonly Segment[] {
  const last = segments[segments.length - 1];
  if (!last || last.kind !== "stay" || last.t1 !== Infinity) return segments;
  return last.t0 >= t ? segments.slice(0, -1) : [...segments.slice(0, -1), { ...last, t1: t }];
}

const openIdle = (at: Vec2, t0: number): Segment => makeStay(at, t0, Infinity);

export function simulate(room: Room, crew: readonly Assignment[], orders: readonly ScheduledOrder[], rng: Rng): SimResult {
  const walls = room.walls.map((w) => grow(w.rect, BODY_RADIUS_M));
  const furniture = room.boxes.filter((b) => b.blocks).map((b) => grow(b.rect, BODY_RADIUS_M));
  const ctx: Ctx = { room, obstacles: [...walls, ...furniture], rng };
  const homePoints = homes(room, crew);
  let workers: readonly WorkerState[] = crew.map((a, i) => ({
    person: a.person,
    station: a.station,
    home: homePoints[i] as Vec2,
    freeAt: 0,
    segments: [openIdle(homePoints[i] as Vec2, 0)],
  }));
  let waiting: readonly (Waiting & { readonly station: StationKey })[] = [];
  let done: readonly DoneRecord[] = [];
  let delivered: Readonly<Record<string, number>> = {};
  let maxQueue: Readonly<Record<StationKey, number>> = { order: 0, make: 0, finish: 0 };
  let walked = 0;
  let released = 0;

  for (let k = 0; ; k += 1) {
    const now = k * TICK_S;
    if (now > MAX_RUN_S) throw new Error(`Run did not finish within ${MAX_RUN_S} s; the world is too slow`);
    while (released < orders.length && (orders[released] as ScheduledOrder).t <= now) {
      const o = orders[released] as ScheduledOrder;
      waiting = [...waiting, { orderId: o.orderId, step: 0, readyAt: o.t, station: "order" }];
      released += 1;
    }
    const byFree = workers.map((w, i) => ({ w, i })).sort((a, b) => a.w.freeAt - b.w.freeAt || a.i - b.i);
    for (const { i } of byFree) {
      const w = workers[i] as WorkerState;
      if (w.freeAt > now) continue;
      const ready = waiting
        .filter((it) => it.station === w.station && it.readyAt <= now)
        .sort((a, b) => a.readyAt - b.readyAt);
      const item = ready[0];
      if (!item) continue;
      const plan = planStep(ctx, w, item, now);
      waiting = waiting.filter((it) => it !== item);
      if ("step" in plan.next) {
        const nextStation = (LATTE_STEPS[plan.next.step] as StepSpec).station;
        waiting = [...waiting, { orderId: item.orderId, step: plan.next.step, readyAt: plan.next.readyAt, station: nextStation }];
      } else {
        delivered = { ...delivered, [item.orderId]: plan.next.deliveredAt };
      }
      done = [...done, plan.done];
      walked += plan.walked;
      const segments = [...closeIdle(w.segments, now), ...plan.segments, openIdle(w.home, plan.freeAt)];
      workers = workers.map((x, j) => (j === i ? { ...w, freeAt: plan.freeAt, segments } : x));
    }
    maxQueue = Object.fromEntries(
      STATIONS.map((s) => [s, Math.max(maxQueue[s], waiting.filter((it) => it.station === s && it.readyAt <= now).length)]),
    ) as Record<StationKey, number>;
    const allDone = Object.keys(delivered).length === orders.length;
    if (allDone && workers.every((w) => w.freeAt <= now)) break;
  }

  const lastFree = Math.max(...workers.map((w) => w.freeAt), ...Object.values(delivered));
  const end = lastFree + uniform(rng, 0.8, 1.4);
  return {
    end,
    done: [...done].sort((a, b) => a.t - b.t),
    delivered,
    segments: Object.fromEntries(workers.map((w) => [w.person.id, closeIdle(w.segments, end)])),
    people: workers.map((w) => w.person),
    maxQueue,
    walkedMetres: walked / Math.max(1, orders.length),
  };
}
