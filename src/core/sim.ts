/**
 * Discrete-event simulation of the staged-run protocol.
 *
 * Stations are FIFO queues; the workers at a station are its servers. A worker
 * takes the oldest waiting item, walks each fetch round trip, works (a sampled
 * measured work time), taps, then carries the item to the next station and
 * walks back before taking the next one. A hand-off (stand points within
 * HANDOFF_REACH_M) costs no walking. The item reaches the next station when
 * the carry ends.
 *
 * Randomness uses common random numbers: for replication r, the work time of
 * order i, step k always comes from the same uniform draw, and the walking pace
 * (bootstrapped from the measured trips) from the same stream, whatever the layout
 * or staffing, so two layouts are compared on the same luck and a drag does not
 * make numbers flicker. Mutable arrays are used inside the event loop for speed;
 * nothing passed in is changed and results are fresh objects.
 */
import type { OrderSchedule } from "./types";
import type { MovementSegment, OrderTrace, RunTrace, StepTrace } from "./trace";
import { streamFor } from "./rng";
import { buildQueueTimeline } from "./timeline";
import { SimError, type ModelStep, type SimModel } from "./model";
import { bootstrapPace, walkSeconds, type Pace } from "./pace";

export type Releases = OrderSchedule["orders"];

export interface ReplicationOptions {
  /** Resample each station's work samples (bootstrap) before drawing. Default true. */
  readonly bootstrap?: boolean;
  /** Also return the full trace for animation. Default false. */
  readonly trace?: boolean;
  /**
   * "calibrated" (default): every replication uses the calibrated pace method.
   * "fit-or-speed": each replication draws its pace model, half the time the
   * overhead + speed fit and half the time one effective speed (both bootstrapped),
   * for walks outside the measured lengths. Only differs when the pace was fitted.
   */
  readonly paceModels?: "calibrated" | "fit-or-speed";
}

export interface Replication {
  /** Per order, in the order of `releases`: finish minus release. */
  readonly orderTimes: readonly number[];
  readonly finishedAt: readonly number[];
  readonly lastFinish: number;
  readonly trace: RunTrace | null;
}

interface Ev {
  readonly t: number;
  readonly seq: number;
  readonly kind: 0 | 1; // 0 arrive, 1 worker free
  readonly a: number; // job (arrive) or station (free)
  readonly b: number; // unused (arrive) or worker index (free)
}

const before = (x: Ev, y: Ev): boolean => x.t < y.t || (x.t === y.t && x.seq < y.seq);

function heapPush(h: Ev[], e: Ev): void {
  h.push(e);
  let i = h.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (!before(h[i] as Ev, h[p] as Ev)) break;
    [h[i], h[p]] = [h[p] as Ev, h[i] as Ev];
    i = p;
  }
}

function heapPop(h: Ev[]): Ev | undefined {
  const top = h[0];
  const last = h.pop();
  if (h.length > 0 && last) {
    h[0] = last;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < h.length && before(h[l] as Ev, h[m] as Ev)) m = l;
      if (r < h.length && before(h[r] as Ev, h[m] as Ev)) m = r;
      if (m === i) break;
      [h[i], h[m]] = [h[m] as Ev, h[i] as Ev];
      i = m;
    }
  }
  return top;
}

function stationPools(model: SimModel, seed: number, rep: number, bootstrap: boolean): readonly (readonly number[])[] {
  if (!bootstrap) return model.samples;
  return model.samples.map((s, i) => {
    const rng = streamFor(seed, rep, 1, model.stationKeys[i] as number);
    return s.map(() => s[Math.floor(rng() * s.length)] as number);
  });
}

/** Run one replication. Deterministic in (model, releases, seed, rep). */
export function runReplication(model: SimModel, releases: Releases, seed: number, rep: number, opts: ReplicationOptions = {}): Replication {
  const n = releases.length;
  const S = model.maxSteps;
  const pools = stationPools(model, seed, rep, opts.bootstrap ?? true);
  const workRng = streamFor(seed, rep, 2);
  const u = new Float64Array(n * S);
  for (let i = 0; i < u.length; i += 1) u[i] = workRng();
  const timed = timedItems(model, replicationPace(model, seed, rep, opts));
  const plans = releases.map((r) => {
    const p = timed.get(r.itemId);
    if (!p) throw new SimError(`Order "${r.orderId}" is for "${r.itemId}", which is not on the menu.`);
    return p;
  });
  const want = opts.trace ?? false;
  const start = new Float64Array(n * S);
  const tap = new Float64Array(n * S);
  const who = new Int32Array(n * S);
  const finished = new Float64Array(n);
  const moves: MovementSegment[] = [];
  const queues: number[][] = model.stationIds.map(() => []);
  const idle: boolean[][] = model.stationWorkers.map((ws) => ws.map(() => true));
  const heap: Ev[] = [];
  let seq = 0;
  releases.forEach((r, i) => heapPush(heap, { t: r.t, seq: seq++, kind: 0, a: i * S, b: 0 }));

  const serve = (job: number, s: number, w: number, now: number): void => {
    const i = Math.floor(job / S);
    const k = job % S;
    const step = (plans[i] as readonly ModelStepLike[])[k] as ModelStepLike;
    const pool = pools[s] as readonly number[];
    const work = step.workSeconds ?? pool[Math.floor((u[job] as number) * pool.length)] as number;
    const t = now + step.fetchSeconds + work;
    start[job] = now;
    tap[job] = t;
    who[job] = w;
    const c = step.carrySeconds;
    const isLast = k === (plans[i] as readonly ModelStepLike[]).length - 1;
    if (isLast) finished[i] = t;
    else heapPush(heap, { t: t + c, seq: seq++, kind: 0, a: job + 1, b: 0 });
    heapPush(heap, { t: t + 2 * c, seq: seq++, kind: 1, a: s, b: w });
    if (want) recordMoves(moves, model, releases[i]?.orderId as string, k, s, w, step, now, t);
  };

  const dispatch = (s: number, now: number): void => {
    const q = queues[s] as number[];
    const free = idle[s] as boolean[];
    while (q.length > 0) {
      const w = free.indexOf(true);
      if (w === -1) return;
      free[w] = false;
      serve(q.shift() as number, s, w, now);
    }
  };

  for (let ev = heapPop(heap); ev; ev = heapPop(heap)) {
    if (ev.kind === 0) {
      const i = Math.floor(ev.a / S);
      const s = ((plans[i] as readonly ModelStepLike[])[ev.a % S] as ModelStepLike).stationIndex;
      (queues[s] as number[]).push(ev.a);
      dispatch(s, ev.t);
    } else {
      (idle[ev.a] as boolean[])[ev.b] = true;
      dispatch(ev.a, ev.t);
    }
  }
  const orderTimes = releases.map((r, i) => (finished[i] as number) - r.t);
  const finishedAt = Array.from(finished);
  const lastFinish = n > 0 ? Math.max(...finishedAt) : 0;
  const trace = want ? buildTrace(model, releases, plans, { start, tap, who, finished }, moves, S) : null;
  return { orderTimes, finishedAt, lastFinish, trace };
}

/** This replication's walking pace. Streams depend only on (seed, rep): the same on every layout. */
function replicationPace(model: SimModel, seed: number, rep: number, opts: ReplicationOptions): Pace {
  if (!(opts.bootstrap ?? true)) return model.pace;
  const rng = streamFor(seed, rep, 3);
  const pick = streamFor(seed, rep, 4)();
  const method = opts.paceModels === "fit-or-speed" && model.paceMethod === "trip-fit" && pick >= 0.5 ? "trip-speed" : model.paceMethod;
  return bootstrapPace(model.paceTrips, method, model.pace, rng);
}

/** A model step with walking turned into seconds for one replication's pace. */
interface TimedStep extends ModelStep {
  readonly fetchLegSeconds: readonly number[];
  readonly fetchSeconds: number;
  readonly carrySeconds: number;
}
type ModelStepLike = TimedStep;

function timedItems(model: SimModel, pace: Pace): ReadonlyMap<string, readonly TimedStep[]> {
  const out = new Map<string, readonly TimedStep[]>();
  for (const [id, steps] of model.items) {
    out.set(
      id,
      steps.map((st) => {
        const fetchLegSeconds = st.fetch.map((l) => walkSeconds(pace, l.oneWayM));
        return { ...st, fetchLegSeconds, fetchSeconds: 2 * fetchLegSeconds.reduce((a, b) => a + b, 0), carrySeconds: walkSeconds(pace, st.carry.oneWayM) };
      }),
    );
  }
  return out;
}

function recordMoves(out: MovementSegment[], model: SimModel, orderId: string, k: number, s: number, w: number, step: ModelStepLike, now: number, tapT: number): void {
  const workerId = (model.stationWorkers[s]?.[w]?.id ?? "") as string;
  let t = now;
  step.fetch.forEach((leg, j) => {
    const sec = step.fetchLegSeconds[j] as number;
    out.push({ workerId, orderId, step: k, kind: "fetch-out", t0: t, t1: t + sec, path: leg.path });
    t += sec;
    out.push({ workerId, orderId, step: k, kind: "fetch-back", t0: t, t1: t + sec, path: [...leg.path].reverse() });
    t += sec;
  });
  const home = model.world.itemsById.get(step.stationId)?.stand;
  out.push({ workerId, orderId, step: k, kind: "work", t0: t, t1: tapT, path: home ? [home] : [] });
  const c = step.carrySeconds;
  if (c > 0) {
    out.push({ workerId, orderId, step: k, kind: "carry-out", t0: tapT, t1: tapT + c, path: step.carry.path });
    out.push({ workerId, orderId, step: k, kind: "carry-back", t0: tapT + c, t1: tapT + 2 * c, path: [...step.carry.path].reverse() });
  }
}

interface Times {
  readonly start: Float64Array;
  readonly tap: Float64Array;
  readonly who: Int32Array;
  readonly finished: Float64Array;
}

function buildTrace(model: SimModel, releases: Releases, plans: readonly (readonly ModelStepLike[])[], tm: Times, moves: readonly MovementSegment[], S: number): RunTrace {
  const orders: OrderTrace[] = releases.map((r, i) => {
    const steps: StepTrace[] = (plans[i] as readonly ModelStepLike[]).map((st, k) => {
      const job = i * S + k;
      return {
        step: k,
        stationId: st.stationId,
        workerId: model.stationWorkers[st.stationIndex]?.[tm.who[job] as number]?.id ?? null,
        arrivedAt: k === 0 ? r.t : (tm.tap[job - 1] as number),
        startedAt: tm.start[job] as number,
        tapAt: tm.tap[job] as number,
        doneAt: tm.tap[job] as number,
      };
    });
    const fin = tm.finished[i] as number;
    return { orderId: r.orderId, itemId: r.itemId, releasedAt: r.t, steps, completed: true, finishedAt: fin, orderTime: fin - r.t };
  });
  const endT = Math.max(0, ...moves.map((m) => m.t1), ...orders.map((o) => o.finishedAt ?? 0));
  const sorted = [...moves].sort((a, b) => a.t0 - b.t0);
  return { orders, queue: buildQueueTimeline(orders, model.stationIds, endT), movements: sorted, endT };
}
