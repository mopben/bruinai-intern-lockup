/**
 * Queue timeline: which tickets sit at which station over time.
 * An item is at station k from when it arrived (release for step 0, else when
 * step k-1 was done) until step k is done.
 */
import type { MenuItem } from "./types";
import type { OrderTrace, QueueInterval, QueueTimeline } from "./trace";

/** Stations in the order the menu first uses them. */
export function menuStations(menu: readonly MenuItem[]): readonly string[] {
  const out: string[] = [];
  for (const m of menu) for (const s of m.steps) if (!out.includes(s.stationId)) out.push(s.stationId);
  return out;
}

export function buildQueueTimeline(orders: readonly OrderTrace[], stationIds: readonly string[], endT: number): QueueTimeline {
  const intervals: QueueInterval[] = [];
  for (const o of orders) {
    let from: number | null = o.releasedAt;
    for (const s of o.steps) {
      if (from === null) break;
      const to = s.doneAt;
      if (to === null || to > from) {
        intervals.push({ stationId: s.stationId, orderId: o.orderId, step: s.step, from, to });
      }
      from = to;
    }
  }
  return { stationIds, intervals, endT };
}

/** Number of tickets at each station at time t (waiting or in progress). */
export function queueAt(timeline: QueueTimeline, t: number): Readonly<Record<string, number>> {
  const counts: Record<string, number> = Object.fromEntries(timeline.stationIds.map((id) => [id, 0]));
  for (const iv of timeline.intervals) {
    if (iv.from <= t && (iv.to === null || t < iv.to)) counts[iv.stationId] = (counts[iv.stationId] ?? 0) + 1;
  }
  return counts;
}

/** Order ids at a station at time t, oldest first: the ticket stack to draw. */
export function ticketsAt(timeline: QueueTimeline, stationId: string, t: number): readonly string[] {
  return timeline.intervals
    .filter((iv) => iv.stationId === stationId && iv.from <= t && (iv.to === null || t < iv.to))
    .sort((a, b) => a.from - b.from)
    .map((iv) => iv.orderId);
}

/** The most tickets ever at each station at once. */
export function peakQueue(timeline: QueueTimeline): Readonly<Record<string, number>> {
  const peaks: Record<string, number> = Object.fromEntries(timeline.stationIds.map((id) => [id, 0]));
  for (const iv of timeline.intervals) {
    const n = queueAt(timeline, iv.from)[iv.stationId] ?? 0;
    if (n > (peaks[iv.stationId] ?? 0)) peaks[iv.stationId] = n;
  }
  return peaks;
}
