/**
 * A short human summary of a generated run, so the bottleneck is visible
 * at a glance in the terminal.
 */
import type { GeneratedRun } from "./generate";
import { LATTE_STEPS, type StationKey } from "./sim";

export interface RunSummary {
  readonly id: string;
  readonly orders: number;
  readonly duration: number;
  /** Order released on the tablet -> last "done" tap, seconds. */
  readonly meanOrderTime: number;
  readonly maxOrderTime: number;
  readonly maxQueue: Readonly<Record<StationKey, number>>;
  readonly walkPerOrder: number;
}

export function summarize(run: GeneratedRun): RunSummary {
  const lastStep = LATTE_STEPS.length - 1;
  const times = run.schedule.map((o) => {
    const fin = run.sim.done.find((d) => d.orderId === o.orderId && d.step === lastStep);
    if (!fin) throw new Error(`Order ${o.orderId} in ${run.config.id} never finished`);
    return fin.t - o.t;
  });
  return {
    id: run.config.id,
    orders: run.schedule.length,
    duration: run.sim.end,
    meanOrderTime: times.reduce((a, b) => a + b, 0) / times.length,
    maxOrderTime: Math.max(...times),
    maxQueue: run.sim.maxQueue,
    walkPerOrder: run.sim.walkedMetres,
  };
}

export function formatSummary(rows: readonly RunSummary[]): string {
  const head = "run                        orders  duration  mean order  max order  walk/order  max queue (order / make / finish)";
  const body = rows.map((r) =>
    [
      r.id.padEnd(26),
      String(r.orders).padStart(6),
      `${r.duration.toFixed(1)} s`.padStart(9),
      `${r.meanOrderTime.toFixed(1)} s`.padStart(11),
      `${r.maxOrderTime.toFixed(1)} s`.padStart(10),
      `${r.walkPerOrder.toFixed(2)} m`.padStart(11),
      `  ${r.maxQueue.order} / ${r.maxQueue.make} / ${r.maxQueue.finish}`,
    ].join(" "),
  );
  return [head, ...body].join("\n") + "\n";
}
