/**
 * Run reconstruction: the tap log -> what happened to each order.
 * Never throws on a messy log; problems go to `warnings`.
 *
 * Rules for messy logs
 * - Taps are read in time order, whatever order the file has them in.
 * - Duplicate taps for the same order and step: the first is kept.
 * - Taps for unknown orders, unknown steps, or before the order's release: ignored.
 * - A tap at the wrong station: kept (the step index wins), with a warning.
 * - Missing or out-of-sequence taps: a step is "done" at the earliest tap of
 *   itself or any later step (a later step being done proves this one was).
 *   With a task graph, "later" means the tasks its output goes on to.
 * - A step arrives on release if it waits for nothing, else when the last task it
 *   waits for is done (unknown while any of those is unknown).
 * - An order with a done tap but no order event takes its release from the schedule.
 *   If the log has no order events at all, the schedule is used up to the end of the run.
 */
import type { DoneEvent, OrderEvent, Setup, TapEvent } from "./types";
import type { OrderTrace, RunTrace, StepTrace } from "./trace";
import { buildQueueTimeline, menuStations } from "./timeline";
import { itemTasks, type ResolvedTask } from "./tasks";

export interface RunReconstruction extends RunTrace {
  readonly warnings: readonly string[];
}

interface Release {
  readonly orderId: string;
  readonly itemId: string;
  readonly t: number;
}

function releasesFrom(setup: Setup, events: readonly TapEvent[], endT: number, warn: (s: string) => void): readonly Release[] {
  const menuIds = new Set(setup.menu.map((m) => m.id));
  const byId = new Map<string, Release>();
  const orderEvents = events.filter((e): e is OrderEvent => e.type === "order");
  for (const e of orderEvents) {
    if (byId.has(e.orderId)) {
      warn(`Order "${e.orderId}" was released twice; the first release is kept.`);
      continue;
    }
    if (!menuIds.has(e.itemId)) {
      warn(`Order "${e.orderId}" is for "${e.itemId}", which is not on the menu; ignored.`);
      continue;
    }
    byId.set(e.orderId, { orderId: e.orderId, itemId: e.itemId, t: e.t });
  }
  const tapped = new Set(events.filter((e): e is DoneEvent => e.type === "done").map((e) => e.orderId));
  if (events.length === 0) return [];
  const noOrderEvents = orderEvents.length === 0;
  if (noOrderEvents && setup.schedule.orders.length > 0) warn("The tap log has no order events; release times come from the schedule.");
  for (const s of setup.schedule.orders) {
    if (byId.has(s.orderId) || !menuIds.has(s.itemId)) continue;
    if (noOrderEvents ? s.t <= endT : tapped.has(s.orderId)) {
      if (!noOrderEvents) warn(`Order "${s.orderId}" has taps but no order event; release taken from the schedule.`);
      byId.set(s.orderId, { orderId: s.orderId, itemId: s.itemId, t: s.t });
    }
  }
  return [...byId.values()].sort((a, b) => a.t - b.t);
}

type TasksByItem = ReadonlyMap<string, readonly ResolvedTask[]>;

function firstTaps(tasks: TasksByItem, releases: readonly Release[], done: readonly DoneEvent[], warn: (s: string) => void): ReadonlyMap<string, readonly (DoneEvent | null)[]> {
  const out = new Map<string, (DoneEvent | null)[]>();
  const relById = new Map(releases.map((r) => [r.orderId, r] as const));
  for (const r of releases) out.set(r.orderId, (tasks.get(r.itemId) ?? []).map(() => null));
  for (const e of done) {
    const rel = relById.get(e.orderId);
    const slots = out.get(e.orderId);
    if (!rel || !slots) {
      warn(`Tap for unknown order "${e.orderId}" at ${e.t.toFixed(1)} s ignored.`);
      continue;
    }
    if (!Number.isInteger(e.step) || e.step < 0 || e.step >= slots.length) {
      warn(`Tap for order "${e.orderId}" names step ${e.step}, which does not exist; ignored.`);
      continue;
    }
    if (e.t < rel.t) {
      warn(`Tap for order "${e.orderId}" at ${e.t.toFixed(1)} s is before its release; ignored.`);
      continue;
    }
    if (slots[e.step] !== null) {
      warn(`Duplicate tap for order "${e.orderId}" step ${e.step + 1}; the first is kept.`);
      continue;
    }
    const expected = tasks.get(rel.itemId)?.[e.step]?.stationId;
    if (expected !== undefined && e.stationId !== expected) {
      warn(`Tap for order "${e.orderId}" step ${e.step + 1} came from "${e.stationId}", expected "${expected}"; kept.`);
    }
    slots[e.step] = e;
  }
  return out;
}

function earlier(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

/** Done time of each task: the earlier of its own tap and its next task's done time. */
function doneTimes(steps: readonly ResolvedTask[], taps: readonly (DoneEvent | null)[]): readonly (number | null)[] {
  const doneAt: (number | null)[] = new Array<number | null>(steps.length).fill(null);
  for (let k = steps.length - 1; k >= 0; k -= 1) {
    const next = steps[k]?.next ?? null;
    const nextDone = next !== null && next > k ? (doneAt[next] ?? null) : null;
    doneAt[k] = earlier(taps[k]?.t ?? null, nextDone);
  }
  return doneAt;
}

function arrivalTime(task: ResolvedTask, releasedAt: number, doneAt: readonly (number | null)[]): number | null {
  if (task.after.length === 0) return releasedAt;
  const inputs = task.after.map((j) => doneAt[j] ?? null);
  return inputs.some((t) => t === null) ? null : Math.max(...(inputs as number[]));
}

/** When every task that goes to the pickup is done. For a chain: the last step's done time. */
function finishTime(steps: readonly ResolvedTask[], doneAt: readonly (number | null)[]): number | null {
  const ends = steps.filter((t) => t.next === null).map((t) => doneAt[t.index] ?? null);
  return ends.length === 0 || ends.some((t) => t === null) ? null : Math.max(...(ends as number[]));
}

function orderTrace(tasks: TasksByItem, rel: Release, taps: readonly (DoneEvent | null)[], warn: (s: string) => void): OrderTrace {
  const steps = tasks.get(rel.itemId) ?? [];
  const doneAt = doneTimes(steps, taps);
  const outOfOrder = taps.some((tap, k) => tap !== null && tap.t !== doneAt[k]);
  if (outOfOrder) warn(`Order "${rel.orderId}" has taps out of sequence; later taps decide when earlier steps were done.`);
  const traces: StepTrace[] = steps.map((s, k) => ({
    step: k,
    stationId: s.stationId,
    workerId: taps[k]?.workerId ?? null,
    arrivedAt: arrivalTime(s, rel.t, doneAt),
    startedAt: null,
    tapAt: taps[k]?.t ?? null,
    doneAt: doneAt[k] ?? null,
  }));
  const finishedAt = finishTime(steps, doneAt);
  return {
    orderId: rel.orderId,
    itemId: rel.itemId,
    releasedAt: rel.t,
    steps: traces,
    completed: finishedAt !== null,
    finishedAt,
    orderTime: finishedAt === null ? null : finishedAt - rel.t,
  };
}

/** Reconstruct a run from its tap log. Orders are returned in release order. */
export function reconstructRun(setup: Setup, taps: readonly TapEvent[]): RunReconstruction {
  const warnings: string[] = [];
  const warn = (s: string): void => {
    warnings.push(s);
  };
  const events = taps
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => Number.isFinite(e.t))
    .sort((a, b) => a.e.t - b.e.t || a.i - b.i)
    .map(({ e }) => e);
  if (events.length < taps.length) warn("Some taps had no valid time and were ignored.");
  const end = events.find((e) => e.type === "end");
  const endT = end?.t ?? events[events.length - 1]?.t ?? 0;
  const releases = releasesFrom(setup, events, endT, warn);
  const done = events.filter((e): e is DoneEvent => e.type === "done");
  const tasks: TasksByItem = new Map(setup.menu.map((m) => [m.id, itemTasks(m)] as const));
  const slots = firstTaps(tasks, releases, done, warn);
  const orders = releases.map((r) => orderTrace(tasks, r, slots.get(r.orderId) ?? [], warn));
  const lastT = Math.max(endT, ...orders.map((o) => o.finishedAt ?? 0));
  return { orders, queue: buildQueueTimeline(orders, menuStations(setup.menu), lastT), movements: [], endT: lastT, warnings };
}
