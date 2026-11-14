/**
 * Whether a recording may stand by for a live run. Its events are spliced into
 * the live run when an input fails, so it must be a run of the same kitchen:
 * the same stations in the scan, the same menu route, the same orders, and only
 * workers the live run knows. Otherwise a failover would mix two kitchens and
 * the saved run would not even be a valid recording.
 */
import type { Layout, RunBundle, Setup } from "../../core";
import { runFitsKitchen, type Kitchen } from "./kitchen-edit";

const route = (s: Setup): string => JSON.stringify(s.menu.map((m) => [m.id, m.steps.map((x) => x.stationId)]));
const orders = (s: Setup): string => JSON.stringify(s.schedule.orders.map((o) => [o.orderId, o.itemId]).sort());

export function standbyFits(recording: Pick<RunBundle, "setup" | "layout">, kitchen: Pick<Kitchen, "scan" | "setup"> & { readonly layout: Layout }): boolean {
  if (!runFitsKitchen(recording, kitchen)) return false;
  if (route(recording.setup) !== route(kitchen.setup)) return false;
  if (orders(recording.setup) !== orders(kitchen.setup)) return false;
  const known = new Set(kitchen.layout.workers.map((w) => w.id));
  return recording.layout.workers.every((w) => known.has(w.id));
}
