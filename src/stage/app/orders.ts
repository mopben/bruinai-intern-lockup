import type { Releases } from "../../core";

export const MIN_ORDERS = 1;
export const MAX_ORDERS = 30;

export function clampOrders(n: number): number {
  return Number.isFinite(n) ? Math.max(MIN_ORDERS, Math.min(MAX_ORDERS, Math.floor(n))) : MIN_ORDERS;
}

export function releasesFor(schedule: Releases, n: number): Releases {
  if (schedule.length === 0) return [];
  const count = clampOrders(n);
  const out = schedule.slice(0, count);
  const ids = new Set(schedule.map((order) => order.orderId));
  const gaps = schedule.slice(1).map((order, i) => order.t - schedule[i]!.t);
  if (gaps.length === 0) gaps.push(schedule[0]!.t > 0 ? schedule[0]!.t : 1);
  while (out.length < count) {
    const index = out.length;
    let id = `sim-${index + 1}`;
    while (ids.has(id)) id += "-sim";
    ids.add(id);
    out.push({
      orderId: id,
      itemId: schedule[index % schedule.length]!.itemId,
      t: out[index - 1]!.t + gaps[(index - schedule.length) % gaps.length]!,
    });
  }
  return out;
}
