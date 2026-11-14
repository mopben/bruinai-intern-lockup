/**
 * Checks across files: ids that must match, taps in protocol order,
 * tracks that jump, actions that fit the room. Runs on whatever parts of the
 * folder could be read.
 */
import type { ActionSegment, ActionsHeader, Layout, PositionSample, PositionsHeader, RunMeta, Scan, Setup, TapEvent, TapsHeader, WorkerDef } from "../../src/core/types";
import { checkActions } from "./check-actions";
import { checkPositions } from "./check-positions";
import { checkTasks } from "./check-tasks";
import { checkTaps } from "./check-taps";

export interface Issue {
  readonly file: string;
  readonly line?: number;
  readonly message: string;
}

export interface Lined<E> {
  readonly line: number;
  readonly value: E;
}

export interface Parsed {
  readonly folderName?: string;
  readonly run?: RunMeta;
  readonly scan?: Scan;
  readonly setup?: Setup;
  readonly layout?: Layout;
  readonly taps?: { readonly header?: TapsHeader; readonly events: readonly Lined<TapEvent>[] };
  readonly positions?: { readonly header?: PositionsHeader; readonly events: readonly Lined<PositionSample>[] };
  /** Only when the folder has the optional actions.jsonl. */
  readonly actions?: { readonly header?: ActionsHeader; readonly events: readonly Lined<ActionSegment>[] };
}

export interface CrossResult {
  readonly errors: readonly Issue[];
  readonly warnings: readonly Issue[];
  readonly facts?: string;
}

export interface Sink {
  error(file: string, message: string, line?: number): void;
  warn(file: string, message: string, line?: number): void;
}

/** A box's name for messages: the owner's name if set up, else its id. */
export function boxLabel(id: string, setup?: Setup): string {
  const item = setup?.items.find((i) => i.boxId === id);
  return item ? `"${item.name}" (${id})` : `"${id}"`;
}

const dupes = (ids: readonly string[]): readonly string[] => [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];

function checkRun(p: Parsed, s: Sink): void {
  if (p.run && p.folderName && p.run.id !== p.folderName) {
    s.warn("run.json", `"id" is "${p.run.id}" but the folder is called "${p.folderName}". Use the same name for both.`);
  }
}

function checkScan(scan: Scan, s: Sink): void {
  for (const id of dupes([...scan.walls.map((w) => w.id), ...scan.boxes.map((b) => b.id)])) {
    s.error("scan.json", `id "${id}" is used more than once. Every wall and box needs its own id.`);
  }
  scan.boxes.forEach((b, i) => {
    const big = Math.max(b.size.w, b.size.h, b.size.d);
    if (big > 6) s.warn("scan.json", `boxes[${i}] (${b.id}) is ${big} m across. Sizes are in metres; is this centimetres?`);
    if (Math.abs(b.yaw) > 2 * Math.PI + 0.01) s.warn("scan.json", `boxes[${i}] (${b.id}) has yaw ${b.yaw}. Yaw is in radians; is this degrees?`);
  });
}

function checkSetup(scan: Scan, setup: Setup, s: Sink): void {
  const role = new Map(setup.items.map((i) => [i.boxId, i.role]));
  const inScan = new Set(scan.boxes.map((b) => b.id));
  setup.items.forEach((it, i) => {
    if (!inScan.has(it.boxId)) s.error("setup.json", `items[${i}] names box "${it.boxId}", which is not in scan.json. Copy the id from scan.json.`);
  });
  for (const id of dupes(setup.items.map((i) => i.boxId))) s.error("setup.json", `box "${id}" appears in "items" more than once.`);
  for (const b of scan.boxes) {
    if (!role.has(b.id)) s.warn("setup.json", `scan box "${b.id}" (${b.category}) has no entry in "items"; it will be treated as a fixture that blocks walking.`);
  }
  const needRole = (id: string, want: string, where: string): void => {
    if (!inScan.has(id)) s.error("setup.json", `${where} names box "${id}", which is not in scan.json.`);
    else if (role.get(id) !== want) s.error("setup.json", `${where} names ${boxLabel(id, setup)}, whose role is "${role.get(id) ?? "none"}"; it must be "${want}".`);
  };
  needRole(setup.pickupId, "pickup", '"pickupId"');
  for (const id of dupes(setup.menu.map((m) => m.id))) s.error("setup.json", `menu item id "${id}" is used more than once.`);
  setup.menu.forEach((m, mi) =>
    m.steps.forEach((st, si) => {
      needRole(st.stationId, "station", `menu[${mi}].steps[${si}].stationId`);
      (st.fetchFrom ?? []).forEach((f, fi) => needRole(f, "storage", `menu[${mi}].steps[${si}].fetchFrom[${fi}]`));
    }),
  );
  checkTasks(setup.menu, s);
  const items = new Set(setup.menu.map((m) => m.id));
  for (const id of dupes(setup.schedule.orders.map((o) => o.orderId))) s.error("setup.json", `schedule order id "${id}" is used more than once.`);
  setup.schedule.orders.forEach((o, i) => {
    if (!items.has(o.itemId)) s.error("setup.json", `schedule.orders[${i}] asks for item "${o.itemId}", which is not on the menu.`);
    const prev = setup.schedule.orders[i - 1];
    if (prev && o.t < prev.t) s.warn("setup.json", `schedule.orders[${i}] (t=${o.t}) comes before the order above it (t=${prev.t}). Keep the schedule in time order.`);
  });
}

function hue(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

function checkCovers(w: WorkerDef, i: number, inScan: ReadonlySet<string>, setup: Setup | undefined, s: Sink): void {
  for (const id of w.covers ?? []) {
    const r = setup?.items.find((it) => it.boxId === id)?.role;
    if (!inScan.has(id)) s.error("layout.json", `workers[${i}] ("${w.id}") covers "${id}", which is not in scan.json.`);
    else if (setup && r !== "station") s.error("layout.json", `workers[${i}] ("${w.id}") covers ${boxLabel(id, setup)}, which is not a station (role "${r ?? "none"}").`);
  }
}

function checkLayout(scan: Scan, setup: Setup | undefined, layout: Layout, s: Sink): void {
  const inScan = new Set(scan.boxes.map((b) => b.id));
  for (const id of Object.keys(layout.placements)) {
    if (!inScan.has(id)) s.error("layout.json", `"placements" has box "${id}", which is not in scan.json.`);
  }
  for (const id of dupes(layout.workers.map((w) => w.id))) s.error("layout.json", `worker id "${id}" is used more than once.`);
  layout.workers.forEach((w, i) => {
    const r = setup?.items.find((it) => it.boxId === w.stationId)?.role;
    if (!inScan.has(w.stationId)) s.error("layout.json", `workers[${i}] ("${w.id}") stands at "${w.stationId}", which is not in scan.json.`);
    else if (setup && r !== "station") s.error("layout.json", `workers[${i}] ("${w.id}") stands at ${boxLabel(w.stationId, setup)}, which is not a station (role "${r ?? "none"}").`);
    checkCovers(w, i, inScan, setup, s);
    layout.workers.slice(0, i).forEach((o) => {
      const gap = Math.abs(hue(w.color) - hue(o.color));
      if (Math.min(gap, 360 - gap) < 25) s.warn("layout.json", `hat colours of "${o.id}" (${o.color}) and "${w.id}" (${w.color}) are close in hue; the camera may mix them up.`);
    });
  });
  const staffed = new Set(layout.workers.flatMap((w) => [w.stationId, ...(w.covers ?? [])]));
  const used = new Set((setup?.menu ?? []).flatMap((m) => m.steps.map((st) => st.stationId)));
  for (const id of used) {
    if (inScan.has(id) && !staffed.has(id)) s.error("layout.json", `nobody works at ${boxLabel(id, setup)}, which a menu step needs. Add a worker with "stationId": "${id}", or add it to a worker's "covers".`);
  }
}

export function crossCheck(p: Parsed): CrossResult {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const at = (file: string, message: string, line?: number): Issue => (line === undefined ? { file, message } : { file, line, message });
  const sink: Sink = {
    error: (f, m, l) => errors.push(at(f, m, l)),
    warn: (f, m, l) => warnings.push(at(f, m, l)),
  };
  checkRun(p, sink);
  if (p.scan) checkScan(p.scan, sink);
  if (p.scan && p.setup) checkSetup(p.scan, p.setup, sink);
  if (p.scan && p.layout) checkLayout(p.scan, p.setup, p.layout, sink);
  const tapFacts = p.taps ? checkTaps(p.taps.events, p.setup, p.layout, sink) : undefined;
  const posFacts = p.positions ? checkPositions(p.positions.header, p.positions.events, p.scan, p.layout, sink) : undefined;
  const actionFacts = p.actions
    ? checkActions(p.actions.events, { scan: p.scan, setup: p.setup, layout: p.layout, runEnd: tapFacts?.duration }, sink)
    : undefined;
  const actionText = actionFacts ? `, ${actionFacts.segments} action segments` : "";
  const facts =
    tapFacts && posFacts && errors.length === 0
      ? `${tapFacts.orders} orders, ${tapFacts.duration.toFixed(1)} s, ${posFacts.workers} workers tracked, ${posFacts.samples} position samples${actionText}`
      : undefined;
  return { errors, warnings, ...(facts ? { facts } : {}) };
}
