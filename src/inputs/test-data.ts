/**
 * Small inline run used by the input and server tests. Not a fixture: just
 * enough to exercise formats and feeds with known answers.
 */
import type { Layout, RunBundle, Scan, Setup } from "../core/types";
import { createListeners, type LinkState, type MessageLink } from "./socket";
import type { Channel } from "./protocol";

export const testScan: Scan = {
  format: "dryrun.scan",
  version: 1,
  units: "m",
  capturedAt: "2026-11-13T10:00:00Z",
  source: "synthetic",
  walls: [{ id: "w1", center: { x: 0, y: 1.2, z: -1.75 }, size: { w: 4.5, h: 2.4, d: 0.1 }, yaw: 0 }],
  boxes: [
    { id: "b-till", category: "table", center: { x: -1.5, y: 0.45, z: -1 }, size: { w: 1, h: 0.9, d: 0.6 }, yaw: 0 },
    { id: "b-make", category: "storage", center: { x: 0, y: 0.45, z: -1 }, size: { w: 1, h: 0.9, d: 0.6 }, yaw: 0 },
    { id: "b-pick", category: "table", center: { x: 1.5, y: 0.45, z: -1 }, size: { w: 1, h: 0.9, d: 0.6 }, yaw: 0, confidence: "high" },
  ],
};

export const testSetup: Setup = {
  format: "dryrun.setup",
  version: 1,
  items: [
    { boxId: "b-till", name: "Order", role: "station", locked: false },
    { boxId: "b-make", name: "Make", role: "station", locked: true },
    { boxId: "b-pick", name: "Pickup", role: "pickup", locked: false },
  ],
  menu: [{ id: "latte", name: "Latte", steps: [{ stationId: "b-till" }, { stationId: "b-make" }] }],
  pickupId: "b-pick",
  schedule: {
    orders: [
      { orderId: "o1", itemId: "latte", t: 0 },
      { orderId: "o2", itemId: "latte", t: 5 },
      { orderId: "o3", itemId: "latte", t: 10 },
    ],
  },
};

export const testLayout: Layout = {
  format: "dryrun.layout",
  version: 1,
  placements: { "b-till": { x: -1.5, z: -1, yaw: 0 } },
  workers: [
    { id: "red", name: "Red", color: "#e04a3a", stationId: "b-till" },
    { id: "blue", name: "Blue", color: "#3a6ee0", stationId: "b-make" },
  ],
};

export const testBundle: RunBundle = {
  meta: {
    format: "dryrun.run",
    version: 1,
    id: "test-run",
    title: "Test run",
    recordedAt: "2026-11-13T10:00:00Z",
    source: "synthetic",
  },
  scan: testScan,
  setup: testSetup,
  layout: testLayout,
  taps: [
    { type: "order", t: 0, orderId: "o1", itemId: "latte" },
    { type: "done", t: 2, orderId: "o1", step: 0, stationId: "b-till" },
    { type: "order", t: 5, orderId: "o2", itemId: "latte" },
    { type: "done", t: 7, orderId: "o2", step: 0, stationId: "b-till" },
    { type: "done", t: 8, orderId: "o1", step: 1, stationId: "b-make", workerId: "blue" },
    { type: "order", t: 10, orderId: "o3", itemId: "latte" },
    { type: "done", t: 12, orderId: "o3", step: 0, stationId: "b-till" },
    { type: "done", t: 15, orderId: "o2", step: 1, stationId: "b-make" },
    { type: "done", t: 21, orderId: "o3", step: 1, stationId: "b-make" },
    { type: "end", t: 22 },
  ],
  positions: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22].flatMap((t) => [
    { type: "pos" as const, t, workerId: "red", x: -1.5, z: -0.4 },
    { type: "pos" as const, t, workerId: "blue", x: 0 + (t % 3) * 0.1, z: -0.4 },
  ]),
};

/** An in-memory hub of links: what one sends, every other link receives. Like the server relay. */
export function createLoopbackHub() {
  const members: { deliver: (channel: Channel, payload: unknown) => void; open: () => boolean }[] = [];
  const link = (): MessageLink & { setState(s: LinkState): void } => {
    const listeners = createListeners();
    let state: LinkState = "open";
    let stateListeners: readonly ((s: LinkState) => void)[] = [];
    const me = {
      deliver: (channel: Channel, payload: unknown) => {
        if (state === "open") listeners.emit({ channel, payload: JSON.parse(JSON.stringify(payload)) as unknown });
      },
      open: () => state === "open",
    };
    members.push(me);
    const setState = (s: LinkState) => {
      state = s;
      stateListeners.forEach((fn) => fn(s));
    };
    return {
      send(channel, payload) {
        if (state !== "open") return false;
        members.filter((m) => m !== me).forEach((m) => m.deliver(channel, payload));
        return true;
      },
      subscribe: listeners.add,
      onState(fn) {
        stateListeners = [...stateListeners, fn];
        return () => {
          stateListeners = stateListeners.filter((f) => f !== fn);
        };
      },
      state: () => state,
      close: () => setState("closed"),
      setState,
    };
  };
  return { link };
}
