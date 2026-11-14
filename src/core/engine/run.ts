/**
 * The task-centred discrete-event engine.
 *
 * Events: an input arrives at a task's station, a worker comes to rest, and (only
 * for stations with a capacity) a station frees a place at a tap. Events run in time
 * order, ties in creation order. After each event, resting workers in layout order ask
 * the task rule for a ready task at a station they cover that has room, until nobody
 * takes one. Then a roaming worker left with nothing, away from home, walks home.
 *
 * A worker that takes a task walks to its station (if elsewhere), walks the fetch round
 * trips, works (a sampled measured time) and taps. The next task's input arrives one
 * carry later. A fixed worker walks back and rests at home; a roaming worker rests at
 * the drop point. An order is finished at its last tap.
 *
 * Randomness uses common random numbers, as the old station-queue engine did: the work time
 * of order i, task k is draw i × maxTasks + k of one stream, and pools and pace are
 * resampled from streams keyed by (seed, replication) alone. Mutable arrays are used
 * inside the event loop for speed; nothing passed in is changed.
 */
import type { MovementSegment, RunTrace } from "../trace";
import { streamFor } from "../rng";
import { bootstrapPace, walkSeconds, type Pace } from "../pace";
import { EventHeap, type Timed } from "./heap";
import { oldestFirst, type ReadyTask, type TaskRule } from "./rule";
import { SimError, walkKey, type EngineLeg, type EngineModel } from "./model";
import { buildTrace, recordTask, recordWalkHome, type Releases, type TimedTask } from "./trace";

export type { Releases } from "./trace";

export interface ReplicationOptions {
  /** Resample each work-sample pool (bootstrap) before drawing. Default true. */
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

export interface EngineOptions extends ReplicationOptions {
  /** Which ready task a resting worker takes. Default oldest-first. */
  readonly rule?: TaskRule;
}

export interface Replication {
  /** Per order, in the order of `releases`: finish minus release. */
  readonly orderTimes: readonly number[];
  readonly finishedAt: readonly number[];
  readonly lastFinish: number;
  readonly trace: RunTrace | null;
  readonly stats: ReplicationStats;
}

/** Per-run counts for the metrics. Collected without random numbers; they change no time. */
export interface ReplicationStats {
  /**
   * Per worker, layout order: seconds walking (to a station, fetch round trips, carry, the walk
   * back, the walk home) plus working, counted only inside the run, [0, lastFinish]. A carry or
   * walk that crosses `lastFinish` counts up to it. Resting and waiting are not counted.
   */
  readonly busyS: readonly number[];
  /** Per station, model order: sum over its tasks of (assigned − ready). */
  readonly waitS: readonly number[];
  /** Per station: number of tasks. */
  readonly waits: readonly number[];
  /** Per station: most tasks ready and unassigned at once, after all events of an instant. */
  readonly peakQueue: readonly number[];
  /** Metres walked to stations and home (roaming workers), not fetch or carry. */
  readonly betweenM: number;
}

const ARRIVE = 0;
const REST = 1;
const FREE = 2;

interface Ev extends Timed {
  readonly kind: typeof ARRIVE | typeof REST | typeof FREE;
  /** Job (arrive), worker index (rest) or station index (free). */
  readonly a: number;
}

/** Mutable state of one replication's event loop. */
interface Loop {
  readonly model: EngineModel;
  readonly releases: Releases;
  readonly plans: readonly (readonly TimedTask[])[];
  readonly S: number;
  readonly u: Float64Array;
  readonly pools: readonly (readonly number[])[];
  readonly pace: Pace;
  readonly rule: TaskRule;
  readonly covers: readonly (readonly boolean[])[];
  readonly heap: EventHeap<Ev>;
  seq: number;
  readyCount: number;
  readonly pending: Int32Array;
  readonly readyAt: Float64Array;
  readonly readySeq: Float64Array;
  readonly ready: number[];
  readonly start: Float64Array;
  readonly tap: Float64Array;
  readonly who: Int32Array;
  readonly finished: Float64Array;
  readonly resting: boolean[];
  readonly atId: string[];
  readonly lastJob: number[];
  readonly occupied: Int32Array;
  readonly moves: MovementSegment[] | null;
  /** Busy stretches, flat: worker, start, end. Clipped to the run when it ends. */
  readonly busyIv: number[];
  readonly waitSum: Float64Array;
  readonly waitN: Int32Array;
  readonly queued: Int32Array;
  readonly peak: Int32Array;
  betweenM: number;
}

function workPools(model: EngineModel, seed: number, rep: number, bootstrap: boolean): readonly (readonly number[])[] {
  if (!bootstrap) return model.pools.map((p) => p.samples);
  return model.pools.map(({ samples: s, key }) => {
    const rng = streamFor(seed, rep, 1, key);
    return s.map(() => s[Math.floor(rng() * s.length)] as number);
  });
}

/** This replication's walking pace. Streams depend only on (seed, rep): the same on every layout. */
function replicationPace(model: EngineModel, seed: number, rep: number, opts: ReplicationOptions): Pace {
  if (!(opts.bootstrap ?? true)) return model.pace;
  const rng = streamFor(seed, rep, 3);
  const pick = streamFor(seed, rep, 4)();
  const method = opts.paceModels === "fit-or-speed" && model.paceMethod === "trip-fit" && pick >= 0.5 ? "trip-speed" : model.paceMethod;
  return bootstrapPace(model.paceTrips, method, model.pace, rng);
}

function timedItems(model: EngineModel, pace: Pace): ReadonlyMap<string, readonly TimedTask[]> {
  const out = new Map<string, readonly TimedTask[]>();
  for (const [id, tasks] of model.items) {
    out.set(
      id,
      tasks.map((t) => {
        const fetchLegSeconds = t.fetch.map((l) => walkSeconds(pace, l.oneWayM));
        return { ...t, fetchLegSeconds, fetchSeconds: 2 * fetchLegSeconds.reduce((a, b) => a + b, 0), carrySeconds: walkSeconds(pace, t.carry.oneWayM) };
      }),
    );
  }
  return out;
}

function push(L: Loop, t: number, kind: Ev["kind"], a: number): void {
  L.heap.push({ t, seq: L.seq++, kind, a });
}

function newLoop(model: EngineModel, releases: Releases, seed: number, rep: number, opts: EngineOptions): Loop {
  const n = releases.length;
  const S = model.maxTasks;
  const workRng = streamFor(seed, rep, 2);
  const u = new Float64Array(n * S);
  for (let i = 0; i < u.length; i += 1) u[i] = workRng();
  const pace = replicationPace(model, seed, rep, opts);
  const timed = timedItems(model, pace);
  const plans = releases.map((r) => {
    const p = timed.get(r.itemId);
    if (!p) throw new SimError(`Order "${r.orderId}" is for "${r.itemId}", which is not on the menu.`);
    return p;
  });
  const pending = new Int32Array(n * S);
  plans.forEach((tasks, i) => tasks.forEach((t) => (pending[i * S + t.index] = Math.max(1, t.after.length))));
  const covers = model.workers.map((w) => model.stationIds.map((_, s) => w.covers.includes(s)));
  return {
    model, releases, plans, S, u, pace, covers,
    pools: workPools(model, seed, rep, opts.bootstrap ?? true),
    rule: opts.rule ?? oldestFirst,
    heap: new EventHeap<Ev>(),
    seq: 0,
    readyCount: 0,
    pending,
    readyAt: new Float64Array(n * S),
    readySeq: new Float64Array(n * S),
    ready: [],
    start: new Float64Array(n * S),
    tap: new Float64Array(n * S),
    who: new Int32Array(n * S).fill(-1),
    finished: new Float64Array(n).fill(-Infinity),
    resting: model.workers.map(() => true),
    atId: model.workers.map((w) => w.homeId),
    lastJob: model.workers.map(() => -1),
    occupied: new Int32Array(model.stationIds.length),
    moves: (opts.trace ?? false) ? [] : null,
    busyIv: [],
    waitSum: new Float64Array(model.stationIds.length),
    waitN: new Int32Array(model.stationIds.length),
    queued: new Int32Array(model.stationIds.length),
    peak: new Int32Array(model.stationIds.length),
    betweenM: 0,
  };
}

const taskOf = (L: Loop, job: number): TimedTask => (L.plans[Math.floor(job / L.S)] as readonly TimedTask[])[job % L.S] as TimedTask;

function walkLeg(L: Loop, from: string, to: string): EngineLeg | null {
  if (from === to) return null;
  const leg = L.model.walks.get(walkKey(from, to));
  if (!leg) throw new Error(`Engine has no walk from "${from}" to "${to}".`);
  return leg;
}

function arrive(L: Loop, job: number, now: number): void {
  L.pending[job] = (L.pending[job] as number) - 1;
  if (L.pending[job] !== 0) return;
  L.readyAt[job] = now;
  L.readySeq[job] = L.readyCount++;
  L.ready.push(job);
  const s = taskOf(L, job).stationIndex;
  L.queued[s] = (L.queued[s] as number) + 1;
}

/** Ready tasks this worker may take now: at a station it covers that has room. */
function candidates(L: Loop, w: number): readonly ReadyTask[] {
  const out: ReadyTask[] = [];
  const at = L.atId[w] as string;
  const cov = L.covers[w] as readonly boolean[];
  for (const job of L.ready) {
    const t = taskOf(L, job);
    const s = t.stationIndex;
    if (!cov[s] || (L.occupied[s] as number) >= (L.model.capacity[s] as number)) continue;
    const walkM = at === t.stationId ? 0 : (walkLeg(L, at, t.stationId) as EngineLeg).oneWayM;
    out.push({ job, stationId: t.stationId, readyAt: L.readyAt[job] as number, seq: L.readySeq[job] as number, walkM });
  }
  return out;
}

function choose(L: Loop, w: number, now: number): number | null {
  const ready = candidates(L, w);
  if (ready.length === 0) return null;
  const ew = L.model.workers[w] as EngineModel["workers"][number];
  const job = L.rule({ id: ew.id, homeId: ew.homeId, atId: L.atId[w] as string }, ready, now);
  if (job !== null && !ready.some((r) => r.job === job)) throw new Error(`The task rule chose job ${job}, which worker "${ew.id}" cannot take now.`);
  return job;
}

/** Worker w takes `job` at `now`: walk, fetch, work, tap; schedule the output and the rest. */
function take(L: Loop, w: number, job: number, now: number): void {
  L.ready.splice(L.ready.indexOf(job), 1);
  L.resting[w] = false;
  const i = Math.floor(job / L.S);
  const task = taskOf(L, job);
  const s = task.stationIndex;
  const ew = L.model.workers[w] as EngineModel["workers"][number];
  L.occupied[s] = (L.occupied[s] as number) + 1;
  const walk = walkLeg(L, L.atId[w] as string, task.stationId);
  const walkSec = walk ? walkSeconds(L.pace, walk.oneWayM) : 0;
  const pool = L.pools[task.pool] as readonly number[];
  const work = pool[Math.floor((L.u[job] as number) * pool.length)] as number;
  const t = now + walkSec + task.fetchSeconds + work;
  L.start[job] = now;
  L.tap[job] = t;
  L.who[job] = w;
  L.finished[i] = Math.max(L.finished[i] as number, t);
  L.lastJob[w] = job;
  const c = task.carrySeconds;
  L.queued[s] = (L.queued[s] as number) - 1;
  L.waitSum[s] = (L.waitSum[s] as number) + (now - (L.readyAt[job] as number));
  L.waitN[s] = (L.waitN[s] as number) + 1;
  L.busyIv.push(w, now, ew.roams ? t + c : t + 2 * c);
  L.betweenM += walk ? walk.oneWayM : 0;
  if (Number.isFinite(L.model.capacity[s])) push(L, t, FREE, s);
  if (task.next !== null) push(L, t + c, ARRIVE, i * L.S + task.next);
  if (ew.roams) {
    L.atId[w] = c > 0 ? task.carryTo : task.stationId;
    push(L, t + c, REST, w);
  } else push(L, t + 2 * c, REST, w);
  if (L.moves) {
    const orderId = L.releases[i]?.orderId as string;
    recordTask(L.moves, L.model, { workerId: ew.id, orderId, task, walk, walkSeconds: walkSec, startedAt: now, tapAt: t, carryBack: !ew.roams });
  }
}

/** Resting workers in layout order take ready tasks until nobody takes one. */
function assignAll(L: Loop, now: number): void {
  for (;;) {
    let any = false;
    for (let w = 0; w < L.resting.length; w += 1) {
      if (!L.resting[w]) continue;
      const job = choose(L, w, now);
      if (job === null) continue;
      take(L, w, job, now);
      any = true;
    }
    if (!any) return;
  }
}

/** A roaming worker resting away from home with nothing to take walks home, taking nothing on the way. */
function sendHome(L: Loop, now: number): void {
  L.model.workers.forEach((ew, w) => {
    const at = L.atId[w] as string;
    if (!L.resting[w] || !ew.roams || at === ew.homeId) return;
    const leg = walkLeg(L, at, ew.homeId) as EngineLeg;
    const sec = walkSeconds(L.pace, leg.oneWayM);
    const t1 = now + sec;
    L.busyIv.push(w, now, t1);
    L.betweenM += leg.oneWayM;
    L.resting[w] = false;
    L.atId[w] = ew.homeId;
    push(L, t1, REST, w);
    const job = L.lastJob[w] as number;
    if (L.moves && job >= 0) recordWalkHome(L.moves, ew.id, L.releases[Math.floor(job / L.S)]?.orderId as string, job % L.S, leg, now, t1);
  });
}

function handle(L: Loop, ev: Ev): void {
  if (ev.kind === ARRIVE) arrive(L, ev.a, ev.t);
  else if (ev.kind === REST) L.resting[ev.a] = true;
  else L.occupied[ev.a] = (L.occupied[ev.a] as number) - 1;
  assignAll(L, ev.t);
  sendHome(L, ev.t);
}

/** Queue peaks, seen once all events of an instant have run: a task taken in the same instant never queued. */
function notePeaks(L: Loop): void {
  for (let s = 0; s < L.queued.length; s += 1) if ((L.queued[s] as number) > (L.peak[s] as number)) L.peak[s] = L.queued[s] as number;
}

/** Each worker's busy seconds inside [0, end]. A worker's stretches never overlap. */
function busyInside(L: Loop, end: number): number[] {
  const out = L.model.workers.map(() => 0);
  const iv = L.busyIv;
  for (let k = 0; k < iv.length; k += 3) {
    const w = iv[k] as number;
    out[w] = (out[w] as number) + Math.max(0, Math.min(iv[k + 2] as number, end) - Math.min(iv[k + 1] as number, end));
  }
  return out;
}

/** Run one replication. Deterministic in (model, releases, seed, rep, rule). */
export function runEngine(model: EngineModel, releases: Releases, seed: number, rep: number, opts: EngineOptions = {}): Replication {
  const L = newLoop(model, releases, seed, rep, opts);
  L.plans.forEach((tasks, i) => {
    for (const t of tasks) if (t.after.length === 0) push(L, (releases[i] as Releases[number]).t, ARRIVE, i * L.S + t.index);
  });
  let now = -Infinity;
  for (let ev = L.heap.pop(); ev; ev = L.heap.pop()) {
    if (ev.t !== now) notePeaks(L);
    now = ev.t;
    handle(L, ev);
  }
  notePeaks(L);
  const finishedAt = Array.from(L.finished);
  const orderTimes = releases.map((r, i) => (finishedAt[i] as number) - r.t);
  const lastFinish = releases.length > 0 ? Math.max(...finishedAt) : 0;
  const trace = L.moves ? buildTrace(model, releases, L.plans, L, L.moves, L.S) : null;
  const stats = { busyS: busyInside(L, lastFinish), waitS: Array.from(L.waitSum), waits: Array.from(L.waitN), peakQueue: Array.from(L.peak), betweenM: L.betweenM };
  return { orderTimes, finishedAt, lastFinish, trace, stats };
}
