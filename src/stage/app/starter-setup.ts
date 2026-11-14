/**
 * A sensible first setup for a live scan that came with none. Pure.
 *
 * The scanner (RoomPlan) knows household categories only, so we guess:
 * - sink, stove, oven, dishwasher, washer-dryer -> fixed equipment, locked;
 * - refrigerator -> storage;
 * - table, storage (cabinets), counter -> counters. Counters from left to right
 *   become stations; the last (right-most) counter becomes the pickup;
 * - a box under 6 cm tall -> a floor mark (queue);
 * - chairs, sofas, beds and the like -> scan noise, hidden.
 * One menu item goes through the stations in order; the middle station fetches
 * from the first storage if there is one. One worker per station, standard hats,
 * and 10 orders about every 6 s (seeded, so the same scan gives the same schedule).
 * The owner then fixes all of it in the panel.
 */
import {
  FORMAT_VERSION,
  LAYOUT_FORMAT,
  SETUP_FORMAT,
  mulberry32,
  type BoxSide,
  type ItemSetup,
  type Layout,
  type Scan,
  type ScanBox,
  type Setup,
  type Vec2,
  type WorkerDef,
} from "../../core";
import { roomBounds } from "../scene/model";

/** Hat colours, in the order workers are added: red, blue, yellow, green. */
export const HAT_COLORS: readonly string[] = ["#e8312f", "#1f6fe0", "#f5c400", "#1fa84f"];
const HAT_NAMES: readonly string[] = ["Red", "Blue", "Yellow", "Green"];

export const STARTER_ORDERS = 10;
export const STARTER_GAP_S = 6;
const STARTER_FIRST_S = 1.5;
const STARTER_JITTER_S = 1;
const STARTER_SEED = 20261114;
const FLOOR_MARK_MAX_H = 0.06;
export const STARTER_ITEM_ID = "item";

const FIXED = /sink|stove|oven|dishwasher|washer|hood|fireplace/i;
const COUNTER = /^(table|storage|counter)$/i;
const NOISE = /chair|sofa|bed|television|tv|toilet|bathtub|stairs|plant/i;

export interface StarterKitchen {
  readonly setup: Setup;
  readonly layout: Layout;
  /** Plain-words problems the owner should fix, e.g. no pickup. */
  readonly notes: readonly string[];
}

const titleCase = (s: string) => (s.length === 0 ? s : s[0]?.toUpperCase() + s.slice(1).replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase());

/** Which side of a box faces `toward` best. */
export function guessStandSide(box: ScanBox, toward: Vec2): BoxSide {
  const dx = toward.x - box.center.x;
  const dz = toward.z - box.center.z;
  const s = Math.sin(box.yaw);
  const c = Math.cos(box.yaw);
  const sides: readonly (readonly [BoxSide, number])[] = [
    ["front", s * dx + c * dz],
    ["back", -(s * dx + c * dz)],
    ["right", c * dx - s * dz],
    ["left", -(c * dx - s * dz)],
  ];
  return sides.reduce((best, side) => (side[1] > best[1] ? side : best))[0];
}

function stationNames(n: number): readonly string[] {
  if (n === 1) return ["Make"];
  if (n === 2) return ["Order", "Make"];
  return Array.from({ length: n }, (_, i) => {
    if (i === 0) return "Order";
    if (i === n - 1) return "Finish";
    if (i === Math.floor((n - 1) / 2)) return "Make";
    return `Station ${i + 1}`;
  });
}

/** 10 orders about every 6 s, the same for the same seed. */
export function starterSchedule(seed = STARTER_SEED): Setup["schedule"] {
  const rng = mulberry32(seed);
  const orders = Array.from({ length: STARTER_ORDERS }, (_, i) => {
    const jitter = (rng() - 0.5) * 2 * STARTER_JITTER_S;
    const t = Math.round((STARTER_FIRST_S + i * STARTER_GAP_S + (i === 0 ? 0 : jitter)) * 100) / 100;
    return { orderId: `o${i + 1}`, itemId: STARTER_ITEM_ID, t };
  });
  return { orders };
}

/** A hat for the k-th worker (colours repeat past four, names get a number). */
export function hatFor(k: number): { readonly color: string; readonly name: string } {
  const i = k % HAT_COLORS.length;
  const round = Math.floor(k / HAT_COLORS.length);
  return { color: HAT_COLORS[i] as string, name: `${HAT_NAMES[i]}${round > 0 ? ` ${round + 1}` : ""}` };
}

export function buildStarterKitchen(scan: Scan): StarterKitchen {
  const bounds = roomBounds({ scan });
  const centre = { x: (bounds.minX + bounds.maxX) / 2, z: (bounds.minZ + bounds.maxZ) / 2 };
  const notes: string[] = [];
  const counters = scan.boxes.filter((b) => COUNTER.test(b.category) && b.size.h >= FLOOR_MARK_MAX_H).sort((a, b) => a.center.x - b.center.x);
  const pickup = counters.length >= 2 ? counters[counters.length - 1] : undefined;
  const stations = pickup ? counters.slice(0, -1) : counters;
  const names = stationNames(stations.length);
  const fridge = scan.boxes.find((b) => /refrigerator|fridge/i.test(b.category));

  const items: ItemSetup[] = scan.boxes.map((b) => {
    const standSide = guessStandSide(b, centre);
    const si = stations.indexOf(b);
    if (si >= 0) return { boxId: b.id, name: names[si] as string, role: "station", locked: false, standSide };
    if (b === pickup) return { boxId: b.id, name: "Pickup", role: "pickup", locked: false, standSide };
    if (b.size.h < FLOOR_MARK_MAX_H) return { boxId: b.id, name: "Queue", role: "queue", locked: false, standSide };
    if (/refrigerator|fridge/i.test(b.category)) return { boxId: b.id, name: b === fridge ? "Fridge" : "Fridge 2", role: "storage", locked: false, standSide };
    if (FIXED.test(b.category)) return { boxId: b.id, name: titleCase(b.category), role: "fixture", locked: true, standSide };
    if (NOISE.test(b.category) || b.confidence === "low") return { boxId: b.id, name: `${titleCase(b.category)} (scan noise)`, role: "ignore", locked: false, standSide };
    return { boxId: b.id, name: titleCase(b.category), role: "fixture", locked: false, standSide };
  });

  if (stations.length === 0) notes.push("No counter was found to work at. Pick a box and make it a station.");
  if (!pickup) notes.push("There is no pickup yet. Pick a counter and make it the pickup.");

  const make = Math.floor((stations.length - 1) / 2);
  const steps = stations.map((s, i) => ({
    stationId: s.id,
    ...(fridge && i === make ? { fetchFrom: [fridge.id] } : {}),
  }));
  const workers: WorkerDef[] = stations.map((s, i) => {
    const hat = hatFor(i);
    return { id: `w${i + 1}`, name: hat.name, color: hat.color, stationId: s.id };
  });

  const setup: Setup = {
    format: SETUP_FORMAT,
    version: FORMAT_VERSION,
    items,
    menu: steps.length > 0 ? [{ id: STARTER_ITEM_ID, name: "Order", steps }] : [],
    pickupId: pickup?.id ?? "",
    schedule: starterSchedule(),
  };
  const layout: Layout = { format: LAYOUT_FORMAT, version: FORMAT_VERSION, placements: {}, workers };
  return { setup, layout, notes };
}
