/**
 * The owner's corrections to a kitchen, as pure functions returning a new
 * kitchen. Nothing here mutates its input.
 */
import type { BoxSide, ItemRole, ItemSetup, Layout, MenuItem, Placement, Scan, ScanBox, Setup, StepDef, WorkerDef } from "../../core";
import { roomBounds } from "../scene/model";
import { hatFor } from "./starter-setup";

export interface Kitchen {
  readonly scan: Scan;
  readonly setup: Setup;
  readonly layout: Layout;
}

/** The setup entry for a box, or a default for a box the owner has not named yet. */
export function itemSetupOf(kitchen: Pick<Kitchen, "scan" | "setup">, boxId: string): ItemSetup {
  const found = kitchen.setup.items.find((i) => i.boxId === boxId);
  if (found) return found;
  const box = kitchen.scan.boxes.find((b) => b.id === boxId);
  return { boxId, name: box?.category ?? boxId, role: "fixture", locked: false, standSide: "front" };
}

function upsertItem(kitchen: Kitchen, boxId: string, change: Partial<ItemSetup>): Setup {
  const next = { ...itemSetupOf(kitchen, boxId), ...change, boxId };
  const exists = kitchen.setup.items.some((i) => i.boxId === boxId);
  const items = exists ? kitchen.setup.items.map((i) => (i.boxId === boxId ? next : i)) : [...kitchen.setup.items, next];
  return { ...kitchen.setup, items };
}

const mapMenu = (setup: Setup, f: (m: MenuItem) => MenuItem): Setup => ({ ...setup, menu: setup.menu.map(f) });

export function renameItem(kitchen: Kitchen, boxId: string, name: string): Kitchen {
  const clean = name.replace(/\s+/g, " ").trimStart().slice(0, 40);
  return { ...kitchen, setup: upsertItem(kitchen, boxId, { name: clean }) };
}

export function setLocked(kitchen: Kitchen, boxId: string, locked: boolean): Kitchen {
  return { ...kitchen, setup: upsertItem(kitchen, boxId, { locked }) };
}

export function setStandSide(kitchen: Kitchen, boxId: string, standSide: BoxSide): Kitchen {
  return { ...kitchen, setup: upsertItem(kitchen, boxId, { standSide }) };
}

/**
 * Change a box's role and keep the process consistent: a box that stops being
 * a station leaves the route and its workers go; a box that stops being storage
 * is no longer fetched from; a new pickup replaces the old one (which becomes a
 * plain fixture).
 */
export function setRole(kitchen: Kitchen, boxId: string, role: ItemRole): Kitchen {
  const before = itemSetupOf(kitchen, boxId).role;
  if (before === role) return kitchen;
  let setup = upsertItem(kitchen, boxId, { role });
  let layout = kitchen.layout;
  if (before === "station") {
    setup = mapMenu(setup, (m) => ({ ...m, steps: m.steps.filter((s) => s.stationId !== boxId) }));
    layout = { ...layout, workers: layout.workers.filter((w) => w.stationId !== boxId) };
  }
  if (before === "storage") {
    setup = mapMenu(setup, (m) => ({ ...m, steps: m.steps.map((s) => withoutFetch(s, boxId)) }));
  }
  if (role === "pickup") {
    const old = setup.pickupId;
    setup = { ...setup, pickupId: boxId };
    if (old !== "" && old !== boxId) setup = upsertItem({ ...kitchen, setup }, old, { role: "fixture" });
  }
  return { ...kitchen, setup, layout };
}

function withoutFetch(step: StepDef, storageId: string): StepDef {
  const rest = (step.fetchFrom ?? []).filter((f) => f !== storageId);
  const { fetchFrom: _fetchFrom, ...remaining } = step;
  return rest.length > 0 ? { ...step, fetchFrom: rest } : remaining;
}

// --- workers ----------------------------------------------------------------

/** Adds a worker at a station with the next free standard hat colour. */
export function addWorker(layout: Layout, stationId: string): Layout {
  const used = new Set(layout.workers.map((w) => w.color));
  let k = 0;
  while (k < 32 && used.has(hatFor(k).color)) k += 1;
  const hat = hatFor(k < 32 ? k : layout.workers.length);
  const ids = new Set(layout.workers.map((w) => w.id));
  let n = layout.workers.length + 1;
  while (ids.has(`w${n}`)) n += 1;
  const worker: WorkerDef = { id: `w${n}`, name: hat.name, color: hat.color, stationId };
  return { ...layout, workers: [...layout.workers, worker] };
}

/** Removes the most recently added worker at a station. */
export function removeWorker(layout: Layout, stationId: string): Layout {
  const index = layout.workers.map((w) => w.stationId).lastIndexOf(stationId);
  if (index < 0) return layout;
  return { ...layout, workers: layout.workers.filter((_, i) => i !== index) };
}

export function workersAt(layout: Layout, stationId: string): number {
  return layout.workers.filter((w) => w.stationId === stationId).length;
}

// --- the route (first menu item) --------------------------------------------

function mapRoute(setup: Setup, f: (steps: readonly StepDef[]) => readonly StepDef[]): Setup {
  if (setup.menu.length === 0) return setup;
  return { ...setup, menu: setup.menu.map((m, i) => (i === 0 ? { ...m, steps: f(m.steps) } : m)) };
}

export function moveRouteStep(kitchen: Kitchen, index: number, delta: -1 | 1): Kitchen {
  const setup = mapRoute(kitchen.setup, (steps) => {
    const j = index + delta;
    if (index < 0 || index >= steps.length || j < 0 || j >= steps.length) return steps;
    const next = [...steps];
    const a = next[index] as StepDef;
    next[index] = next[j] as StepDef;
    next[j] = a;
    return next;
  });
  return { ...kitchen, setup };
}

export function removeRouteStep(kitchen: Kitchen, index: number): Kitchen {
  return { ...kitchen, setup: mapRoute(kitchen.setup, (steps) => steps.filter((_, i) => i !== index)) };
}

/** Adds a station to the end of the route; gives it a worker if it has none. */
export function addRouteStation(kitchen: Kitchen, stationId: string): Kitchen {
  if (kitchen.setup.menu.length === 0) {
    const menu: MenuItem[] = [{ id: "item", name: "Order", steps: [{ stationId }] }];
    const setup = { ...kitchen.setup, menu, schedule: { orders: kitchen.setup.schedule.orders.map((o) => ({ ...o, itemId: "item" })) } };
    return withWorker({ ...kitchen, setup }, stationId);
  }
  const setup = mapRoute(kitchen.setup, (steps) => (steps.some((s) => s.stationId === stationId) ? steps : [...steps, { stationId }]));
  return withWorker({ ...kitchen, setup }, stationId);
}

function withWorker(kitchen: Kitchen, stationId: string): Kitchen {
  return workersAt(kitchen.layout, stationId) > 0 ? kitchen : { ...kitchen, layout: addWorker(kitchen.layout, stationId) };
}

/** Turns fetching from a storage on or off for one step of the route. */
export function toggleFetch(kitchen: Kitchen, index: number, storageId: string): Kitchen {
  const setup = mapRoute(kitchen.setup, (steps) =>
    steps.map((s, i) => {
      if (i !== index) return s;
      const has = (s.fetchFrom ?? []).includes(storageId);
      return has ? withoutFetch(s, storageId) : { ...s, fetchFrom: [...(s.fetchFrom ?? []), storageId] };
    }),
  );
  return { ...kitchen, setup };
}

// --- correcting the scan ----------------------------------------------------

const SPLIT_SUFFIX = "-b";

/** Long boxes (one side at least this long) can be split in two. */
export const SPLIT_MIN_M = 0.9;

export function canSplit(box: ScanBox | undefined): boolean {
  return box !== undefined && Math.max(box.size.w, box.size.d) >= SPLIT_MIN_M && box.size.h >= 0.06;
}

function offsetAlong(p: { x: number; z: number }, yaw: number, alongX: boolean, by: number): { x: number; z: number } {
  // Local x -> world (cos, -sin); local z -> world (sin, cos). See DECISIONS "Yaw follows three.js".
  const dx = alongX ? Math.cos(yaw) : Math.sin(yaw);
  const dz = alongX ? -Math.sin(yaw) : Math.cos(yaw);
  return { x: p.x + dx * by, z: p.z + dz * by };
}

/**
 * Splits one long scanned box into two halves along its long axis. The first
 * half keeps the box id (so a recorded run still refers to it), the second gets
 * a new id. A station in the route is followed by its new half, which gets a worker.
 */
export function splitBox(kitchen: Kitchen, boxId: string): { readonly kitchen: Kitchen; readonly newId: string } | null {
  const box = kitchen.scan.boxes.find((b) => b.id === boxId);
  if (!box || !canSplit(box)) return null;
  const alongX = box.size.w >= box.size.d;
  const half = (alongX ? box.size.w : box.size.d) / 2;
  const size = alongX ? { ...box.size, w: half } : { ...box.size, d: half };
  let newId = `${boxId}${SPLIT_SUFFIX}`;
  while (kitchen.scan.boxes.some((b) => b.id === newId)) newId += "b";
  const shift = (p: { x: number; z: number }, sign: number) => offsetAlong(p, box.yaw, alongX, (sign * half) / 2);
  const c1 = shift(box.center, -1);
  const c2 = shift(box.center, 1);
  const boxes = kitchen.scan.boxes.flatMap((b) =>
    b.id !== boxId
      ? [b]
      : [
          { ...b, size, center: { ...b.center, ...c1 } },
          { ...b, id: newId, size, center: { ...b.center, ...c2 } },
        ],
  );
  const placed = kitchen.layout.placements[boxId];
  const placements: Record<string, Placement> = { ...kitchen.layout.placements };
  if (placed) {
    const yaw = placed.yaw;
    const along = (sign: number) => offsetAlong(placed, yaw, alongX, (sign * half) / 2);
    placements[boxId] = { ...placed, ...along(-1) };
    placements[newId] = { ...placed, ...along(1) };
  }
  const original = itemSetupOf(kitchen, boxId);
  const first: ItemSetup = { ...original, name: `${original.name} 1` };
  // There is one pickup: the second half of a split pickup is plain counter (a fixture).
  const second: ItemSetup = { ...original, boxId: newId, name: `${original.name} 2`, ...(original.role === "pickup" ? { role: "fixture" as const } : {}) };
  const items = kitchen.setup.items.some((i) => i.boxId === boxId)
    ? kitchen.setup.items.flatMap((i) => (i.boxId === boxId ? [first, second] : [i]))
    : [...kitchen.setup.items, first, second];
  let setup: Setup = { ...kitchen.setup, items };
  let layout: Layout = { ...kitchen.layout, placements };
  const inRoute = setup.menu[0]?.steps.some((s) => s.stationId === boxId) ?? false;
  if (original.role === "station" && inRoute) {
    setup = mapRoute(setup, (steps) => steps.flatMap((s) => (s.stationId === boxId ? [s, { stationId: newId }] : [s])));
    layout = addWorker(layout, newId);
  }
  return { kitchen: { scan: { ...kitchen.scan, boxes }, setup, layout }, newId };
}

export const FLOOR_MARK_SIZE = { w: 1.2, h: 0.02, d: 0.5 } as const;

/**
 * Adds a floor mark (taped queue or pickup spot, which a scanner cannot see)
 * as a thin box in the middle of the room. Role defaults to queue.
 */
export function addFloorMark(kitchen: Kitchen, role: Extract<ItemRole, "queue" | "pickup"> = "queue"): { readonly kitchen: Kitchen; readonly newId: string } {
  const b = roomBounds(kitchen);
  let n = 1;
  while (kitchen.scan.boxes.some((x) => x.id === `mark-${n}`)) n += 1;
  const newId = `mark-${n}`;
  const box: ScanBox = {
    id: newId,
    category: "floor mark",
    center: { x: (b.minX + b.maxX) / 2, y: FLOOR_MARK_SIZE.h / 2, z: (b.minZ + b.maxZ) / 2 },
    size: { ...FLOOR_MARK_SIZE },
    yaw: 0,
  };
  const scan = { ...kitchen.scan, boxes: [...kitchen.scan.boxes, box] };
  const named: Kitchen = {
    ...kitchen,
    scan,
    setup: { ...kitchen.setup, items: [...kitchen.setup.items, { boxId: newId, name: role === "queue" ? "Queue" : "Pickup", role: "queue", locked: false, standSide: "front" }] },
  };
  return { kitchen: role === "pickup" ? setRole(named, newId, "pickup") : named, newId };
}

/**
 * Can a run recorded in `recorded` be read in `current`? True when every box
 * people work at in the recorded kitchen (stations, storage, pickup) is still
 * in the current scan. Renames, floor marks and splits keep a run readable; a
 * fresh scan with new boxes does not.
 */
export function runFitsKitchen(recorded: Pick<Kitchen, "setup">, current: Pick<Kitchen, "scan">): boolean {
  const ids = new Set(current.scan.boxes.map((b) => b.id));
  const needed = recorded.setup.items.filter((i) => i.role === "station" || i.role === "storage" || i.role === "pickup");
  return needed.length > 0 && needed.every((i) => ids.has(i.boxId));
}
