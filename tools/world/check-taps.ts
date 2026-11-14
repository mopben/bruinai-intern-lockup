/**
 * taps.jsonl against the protocol: every "done" belongs to a shown order,
 * names the right station, and comes after the step before it (or, for an
 * item with tasks, after the tasks in its "after" list).
 */
import type { DoneEvent, Layout, OrderEvent, Setup, TapEvent, TaskDef } from "../../src/core/types";
import { boxLabel, type Lined, type Sink } from "./checks";

const F = "taps.jsonl";

function checkTimeOrder(events: readonly Lined<TapEvent>[], s: Sink): void {
  events.forEach((e, i) => {
    const prev = events[i - 1];
    if (prev && e.value.t < prev.value.t) {
      s.warn(F, `t=${e.value.t} is earlier than the line above (t=${prev.value.t}). Lines are read in time order anyway, but check the clock.`, e.line);
    }
  });
  const ends = events.filter((e) => e.value.type === "end");
  if (ends.length > 1) ends.slice(1).forEach((e) => s.error(F, 'a second "end" line. A run has at most one; delete the extras.', e.line));
  const end = ends[0];
  if (!end) s.warn(F, 'there is no "end" line. The run will be taken to end at the last tap. Add {"type":"end","t":...} as the last line.');
  else {
    events.filter((e) => e.value.type !== "end" && e.value.t > end.value.t).forEach((e) => {
      s.error(F, `this line (t=${e.value.t}) comes after the "end" (t=${end.value.t}). Move the "end" later or delete this line.`, e.line);
    });
  }
}

function checkOrders(orders: readonly Lined<OrderEvent>[], setup: Setup | undefined, s: Sink): void {
  const seen = new Set<string>();
  for (const o of orders) {
    if (seen.has(o.value.orderId)) s.error(F, `order "${o.value.orderId}" is shown twice. Delete one of the "order" lines.`, o.line);
    seen.add(o.value.orderId);
    if (!setup) continue;
    if (!setup.menu.some((m) => m.id === o.value.itemId)) s.error(F, `order "${o.value.orderId}" is for item "${o.value.itemId}", which is not on the menu in setup.json.`, o.line);
    const planned = setup.schedule.orders.find((x) => x.orderId === o.value.orderId);
    if (!planned) s.warn(F, `order "${o.value.orderId}" is not in the schedule in setup.json.`, o.line);
    else if (Math.abs(planned.t - o.value.t) > 1) {
      s.warn(F, `order "${o.value.orderId}" was shown at t=${o.value.t} but the schedule says t=${planned.t}. Was the start trimmed?`, o.line);
    }
  }
  if (setup) {
    for (const p of setup.schedule.orders) {
      if (!seen.has(p.orderId)) s.warn(F, `scheduled order "${p.orderId}" (t=${p.t}) never appears as an "order" line.`);
    }
  }
}

type Tapped = ReadonlyMap<string, Lined<DoneEvent>>;

/** A chain item: step k comes after step k-1. */
function checkChainOrder(d: Lined<DoneEvent>, tapped: Tapped, s: Sink): void {
  const { orderId, step, t } = d.value;
  if (step === 0) return;
  const before = tapped.get(`${orderId}#${step - 1}`);
  if (!before) s.error(F, `order "${orderId}" step ${step} is tapped before step ${step - 1}. Steps are tapped in order; fix the step number or add the missing tap.`, d.line);
  else if (before.value.t > t) s.error(F, `order "${orderId}" step ${step} (t=${t}) is earlier than step ${step - 1} (t=${before.value.t}, line ${before.line}).`, d.line);
}

/** An item with tasks: a task comes after the tasks in its `after` list, nothing else. Unknown ids are reported for setup.json. */
function checkTaskOrder(d: Lined<DoneEvent>, tasks: readonly TaskDef[], tapped: Tapped, s: Sink): void {
  const { orderId, step, t } = d.value;
  const task = tasks[step];
  if (!task) return;
  for (const id of new Set(task.after ?? [])) {
    const k = tasks.findIndex((x) => x.id === id);
    if (k < 0 || k === step) continue;
    const name = `task "${task.id}" (step ${step})`;
    const dep = `task "${id}" (step ${k})`;
    const before = tapped.get(`${orderId}#${k}`);
    if (!before) s.error(F, `order "${orderId}" ${name} is tapped before ${dep}, which it waits for. Fix the step number or add the missing tap.`, d.line);
    else if (before.value.t > t) s.error(F, `order "${orderId}" ${name} (t=${t}) is earlier than ${dep} (t=${before.value.t}, line ${before.line}), which it waits for.`, d.line);
  }
}

function checkDones(
  dones: readonly Lined<DoneEvent>[],
  orders: ReadonlyMap<string, Lined<OrderEvent>>,
  setup: Setup | undefined,
  layout: Layout | undefined,
  s: Sink,
): void {
  const tapped = new Map<string, Lined<DoneEvent>>();
  const workers = new Set((layout?.workers ?? []).map((w) => w.id));
  for (const d of dones) {
    const { orderId, step, stationId, workerId, t } = d.value;
    const key = `${orderId}#${step}`;
    const order = orders.get(orderId);
    if (tapped.has(key)) {
      s.error(F, `order "${orderId}" step ${step} is tapped twice (first on line ${tapped.get(key)?.line}). Delete the extra tap.`, d.line);
      continue;
    }
    tapped.set(key, d);
    if (layout && workerId !== undefined && !workers.has(workerId)) s.warn(F, `"workerId" "${workerId}" is not a worker in layout.json.`, d.line);
    if (!order) {
      s.error(F, `"done" for order "${orderId}", but no "order" line shows that order. Add the order line or fix the orderId.`, d.line);
      continue;
    }
    if (t < order.value.t) s.error(F, `order "${orderId}" step ${step} is tapped at t=${t}, before the order was shown (t=${order.value.t}).`, d.line);
    const item = setup?.menu.find((m) => m.id === order.value.itemId);
    if (!item) continue;
    const def = item.steps[step];
    if (!def) {
      s.error(F, `step ${step} does not exist: "${item.id}" has steps 0 to ${item.steps.length - 1}.`, d.line);
      continue;
    }
    if (def.stationId !== stationId) {
      s.error(F, `step ${step} of "${item.id}" happens at ${boxLabel(def.stationId, setup)}, but this tap names ${boxLabel(stationId, setup)}.`, d.line);
    }
    if (item.tasks) checkTaskOrder(d, item.tasks, tapped, s);
    else checkChainOrder(d, tapped, s);
  }
  if (!setup) return;
  for (const [orderId, o] of orders) {
    const item = setup.menu.find((m) => m.id === o.value.itemId);
    const missing = (item?.steps ?? []).map((_, i) => i).filter((i) => !tapped.has(`${orderId}#${i}`));
    if (missing.length > 0) {
      s.warn(F, `order "${orderId}" has no tap for step${missing.length > 1 ? "s" : ""} ${missing.join(", ")}. Fine if the run was cut short; otherwise add the tap.`);
    }
  }
}

export function checkTaps(
  events: readonly Lined<TapEvent>[],
  setup: Setup | undefined,
  layout: Layout | undefined,
  s: Sink,
): { orders: number; duration: number } {
  checkTimeOrder(events, s);
  const sorted = [...events].sort((a, b) => a.value.t - b.value.t || a.line - b.line);
  const orders = sorted.filter((e): e is Lined<OrderEvent> => e.value.type === "order");
  const dones = sorted.filter((e): e is Lined<DoneEvent> => e.value.type === "done");
  checkOrders(orders, setup, s);
  const firstOrder = new Map<string, Lined<OrderEvent>>();
  for (const o of orders) if (!firstOrder.has(o.value.orderId)) firstOrder.set(o.value.orderId, o);
  checkDones(dones, firstOrder, setup, layout, s);
  const duration = sorted.reduce((m, e) => Math.max(m, e.value.t), 0);
  return { orders: firstOrder.size, duration };
}
