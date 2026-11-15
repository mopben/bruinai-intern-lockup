/**
 * The engine's trace: movement segments for the animation and the per-order step
 * record, in the shapes of ../trace.ts.
 */
import type { MovementSegment, OrderTrace, RunTrace, StepTrace } from "../trace";
import type { Vec2 } from "../types";
import { buildQueueTimeline } from "../timeline";
import type { EngineLeg, EngineModel, EngineTask } from "./model";

export type Releases = readonly { readonly orderId: string; readonly itemId: string; readonly t: number }[];

/** A task with its walks turned into seconds for one replication's pace. */
export interface TimedTask extends EngineTask {
  readonly fetchLegSeconds: readonly number[];
  readonly fetchSeconds: number;
  readonly carrySeconds: number;
}

/** What one worker did for one task, for the movement trace. */
export interface TaskMoves {
  readonly workerId: string;
  readonly orderId: string;
  readonly task: TimedTask;
  /** Walk to the station first; null when already there. */
  readonly walk: EngineLeg | null;
  readonly walkSeconds: number;
  readonly startedAt: number;
  readonly tapAt: number;
  /** Fixed workers walk back after the carry; roaming workers stay at the drop point. */
  readonly carryBack: boolean;
}

const back = (path: readonly Vec2[]): readonly Vec2[] => [...path].reverse();

export function recordTask(out: MovementSegment[], model: EngineModel, m: TaskMoves): void {
  const { workerId, orderId, task } = m;
  const step = task.index;
  let t = m.startedAt;
  if (m.walk && m.walkSeconds > 0) {
    out.push({ workerId, orderId, step, kind: "walk", t0: t, t1: t + m.walkSeconds, path: m.walk.path });
    t += m.walkSeconds;
  }
  task.fetch.forEach((leg, j) => {
    const sec = task.fetchLegSeconds[j] as number;
    out.push({ workerId, orderId, step, kind: "fetch-out", t0: t, t1: t + sec, path: leg.path });
    t += sec;
    out.push({ workerId, orderId, step, kind: "fetch-back", t0: t, t1: t + sec, path: back(leg.path) });
    t += sec;
  });
  const stand = model.world.itemsById.get(task.stationId)?.stand;
  out.push({ workerId, orderId, step, kind: "work", t0: t, t1: m.tapAt, path: stand ? [stand] : [] });
  const c = task.carrySeconds;
  if (c > 0) {
    out.push({ workerId, orderId, step, kind: "carry-out", t0: m.tapAt, t1: m.tapAt + c, path: task.carry.path });
    if (m.carryBack) out.push({ workerId, orderId, step, kind: "carry-back", t0: m.tapAt + c, t1: m.tapAt + 2 * c, path: back(task.carry.path) });
  }
}

/** A roaming worker walking home with nothing to do; filed under the task it last did. */
export function recordWalkHome(out: MovementSegment[], workerId: string, orderId: string, step: number, leg: EngineLeg, t0: number, t1: number): void {
  out.push({ workerId, orderId, step, kind: "walk", t0, t1, path: leg.path });
}

export interface Times {
  readonly start: Float64Array;
  readonly tap: Float64Array;
  readonly who: Int32Array;
  readonly finished: Float64Array;
}

function stepTrace(model: EngineModel, r: Releases[number], i: number, st: TimedTask, tm: Times, S: number): StepTrace {
  const job = i * S + st.index;
  const arrivedAt = st.after.length === 0 ? r.t : Math.max(...st.after.map((j) => tm.tap[i * S + j] as number));
  const w = tm.who[job] as number;
  return {
    step: st.index,
    stationId: st.stationId,
    workerId: w >= 0 ? (model.workers[w]?.id ?? null) : null,
    arrivedAt,
    startedAt: w >= 0 ? (tm.start[job] as number) : null,
    tapAt: w >= 0 ? (tm.tap[job] as number) : null,
    doneAt: w >= 0 ? (tm.tap[job] as number) : null,
  };
}

export function buildTrace(model: EngineModel, releases: Releases, plans: readonly (readonly TimedTask[])[], tm: Times, moves: readonly MovementSegment[], S: number): RunTrace {
  const orders: OrderTrace[] = releases.map((r, i) => {
    const steps = (plans[i] as readonly TimedTask[]).map((st) => stepTrace(model, r, i, st, tm, S));
    const fin = tm.finished[i] as number;
    const completed = steps.every((s) => s.tapAt !== null);
    return { orderId: r.orderId, itemId: r.itemId, releasedAt: r.t, steps, completed, finishedAt: completed ? fin : null, orderTime: completed ? fin - r.t : null };
  });
  const endT = Math.max(0, ...moves.map((m) => m.t1), ...orders.map((o) => o.finishedAt ?? 0));
  const sorted = [...moves].sort((a, b) => a.t0 - b.t0);
  return { orders, queue: buildQueueTimeline(orders, model.stationIds, endT), movements: sorted, endT };
}
