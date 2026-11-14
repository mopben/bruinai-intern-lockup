/**
 * Builds one run folder's six files (as text) from a run config.
 * Pure: the same config gives byte-identical output.
 */
import {
  FORMAT_VERSION,
  LAYOUT_FORMAT,
  POSITIONS_FORMAT,
  RUN_FORMAT,
  SETUP_FORMAT,
  TAPS_FORMAT,
  type Layout,
  type OrderSchedule,
  type Placement,
  type RunMeta,
  type Scan,
  type Setup,
  type TapEvent,
} from "../../src/core/types";
import { observePositions, CAMERA } from "./observe";
import { CREW, drawPerson, onTheDay, type Person } from "./people";
import { fork, makeRng, normal, uniform } from "./rng";
import { stagedCounter, type BoxKey, type Room } from "./room";
import { PEOPLE_SEED, SCAN_CAPTURED_AT, SCAN_SEED, SCHEDULE_SEED, SCHEDULE_SPEC, type RunConfig } from "./runs";
import { scanRoom, type ScannedRoom } from "./scan";
import { LATTE_STEPS, simulate, type ScheduledOrder, type SimResult } from "./sim";

export const ITEM_ID = "latte";
export const FILE_NAMES = ["run.json", "scan.json", "setup.json", "layout.json", "taps.jsonl", "positions.jsonl"] as const;
export type FileName = (typeof FILE_NAMES)[number];

const r2 = (v: number): number => Math.round(v * 100) / 100;
const r3 = (v: number): number => Math.round(v * 1000) / 1000;
const r4 = (v: number): number => Math.round(v * 10000) / 10000;
const json = (v: unknown): string => `${JSON.stringify(v, null, 2)}\n`;
const jsonl = (lines: readonly unknown[]): string => lines.map((l) => JSON.stringify(l)).join("\n") + "\n";

export function makeSchedule(): readonly ScheduledOrder[] {
  const rng = makeRng(SCHEDULE_SEED);
  const s = SCHEDULE_SPEC;
  return Array.from({ length: s.count }, (_, i) => ({
    orderId: `o${i + 1}`,
    t: r2(s.first + i * s.every + uniform(rng, -s.jitter, s.jitter)),
  }));
}

/** The one scan of the original room, shared by all runs. */
export function makeScan(): ScannedRoom {
  return scanRoom(stagedCounter(), makeRng(SCAN_SEED), SCAN_CAPTURED_AT);
}

/** The same people every run. */
export function makePeople(): readonly Person[] {
  const rng = makeRng(PEOPLE_SEED);
  return CREW.map((seed) => drawPerson(fork(rng, seed.id), seed));
}

function makeSetup(ids: Readonly<Record<BoxKey, string>>, room: Room, schedule: readonly ScheduledOrder[]): Setup {
  const orderSchedule: OrderSchedule = { orders: schedule.map((o) => ({ orderId: o.orderId, itemId: ITEM_ID, t: o.t })) };
  return {
    format: SETUP_FORMAT,
    version: FORMAT_VERSION,
    items: room.boxes.map((b) => ({ boxId: ids[b.key], name: b.name, role: b.role, locked: b.locked, standSide: b.standSide })),
    menu: [
      {
        id: ITEM_ID,
        name: "Latte",
        steps: LATTE_STEPS.map((s) =>
          s.fetch.length > 0 ? { stationId: ids[s.station], fetchFrom: s.fetch.map((k) => ids[k]) } : { stationId: ids[s.station] },
        ),
      },
    ],
    pickupId: ids.pickup,
    schedule: orderSchedule,
  };
}

/** Placements: where the scan put each box, except boxes that really moved in this run (placed by hand, to a cm or so). */
function makeLayout(scanned: ScannedRoom, base: Room, room: Room, cfg: RunConfig, people: readonly Person[], seed: number): Layout {
  const rng = makeRng(seed);
  const keyOf = Object.fromEntries(Object.entries(scanned.ids).map(([k, id]) => [id, k as BoxKey]));
  const placements: Record<string, Placement> = Object.fromEntries(
    scanned.scan.boxes.map((b) => {
      const key = keyOf[b.id] as BoxKey;
      const before = base.boxes.find((x) => x.key === key);
      const now = room.boxes.find((x) => x.key === key);
      const moved = before && now && (before.rect.cx !== now.rect.cx || before.rect.cz !== now.rect.cz || before.rect.yaw !== now.rect.yaw);
      const placement: Placement =
        moved && now
          ? { x: r4(now.rect.cx + normal(rng, 0, 0.008)), z: r4(now.rect.cz + normal(rng, 0, 0.008)), yaw: r4(now.rect.yaw + normal(rng, 0, 0.006)) }
          : { x: b.center.x, z: b.center.z, yaw: b.yaw };
      return [b.id, placement];
    }),
  );
  return {
    format: LAYOUT_FORMAT,
    version: FORMAT_VERSION,
    placements,
    workers: cfg.crew.map((c) => {
      const p = people.find((x) => x.id === c.personId);
      if (!p) throw new Error(`Run ${cfg.id} names unknown person ${c.personId}`);
      return { id: p.id, name: p.name, color: p.color, stationId: scanned.ids[c.station] };
    }),
  };
}

function tapLines(sim: SimResult, schedule: readonly ScheduledOrder[], ids: Readonly<Record<BoxKey, string>>): readonly TapEvent[] {
  const orders: TapEvent[] = schedule.map((o) => ({ type: "order", t: o.t, orderId: o.orderId, itemId: ITEM_ID }));
  const dones: TapEvent[] = sim.done.map((d) => ({
    type: "done",
    t: r3(d.t),
    orderId: d.orderId,
    step: d.step,
    stationId: ids[d.station],
    workerId: d.workerId,
  }));
  const rank = (e: TapEvent): number => (e.type === "order" ? 0 : e.type === "done" ? 1 : 2);
  const events = [...orders, ...dones].sort((a, b) => a.t - b.t || rank(a) - rank(b));
  return [...events, { type: "end", t: r3(sim.end) }];
}

export interface GeneratedRun {
  readonly config: RunConfig;
  readonly files: Readonly<Record<FileName, string>>;
  readonly sim: SimResult;
  readonly schedule: readonly ScheduledOrder[];
  readonly room: Room;
  readonly scan: Scan;
  readonly ids: Readonly<Record<BoxKey, string>>;
}

export function generateRun(cfg: RunConfig): GeneratedRun {
  const base = stagedCounter();
  const room = stagedCounter(cfg.fridge);
  const scanned = makeScan();
  const schedule = makeSchedule();
  const rng = makeRng(cfg.seed);
  const dayRng = fork(rng, "day");
  const people = makePeople().map((p) => onTheDay(fork(dayRng, p.id), p));
  const crew = cfg.crew.map((c) => {
    const person = people.find((p) => p.id === c.personId);
    if (!person) throw new Error(`Run ${cfg.id} names unknown person ${c.personId}`);
    return { person, station: c.station };
  });
  const sim = simulate(room, crew, schedule, fork(rng, "work"));
  const positions = observePositions(sim, fork(rng, "camera"));
  const meta: RunMeta = {
    format: RUN_FORMAT,
    version: FORMAT_VERSION,
    id: cfg.id,
    title: cfg.title,
    ...(cfg.change ? { change: cfg.change } : {}),
    ...(cfg.baseRunId ? { baseRunId: cfg.baseRunId } : {}),
    recordedAt: cfg.startedAt,
    source: "synthetic",
  };
  const files: Record<FileName, string> = {
    "run.json": json(meta),
    "scan.json": json(scanned.scan),
    "setup.json": json(makeSetup(scanned.ids, base, schedule)),
    "layout.json": json(makeLayout(scanned, base, room, cfg, people, cfg.seed + 1)),
    "taps.jsonl": jsonl([
      { type: "header", format: TAPS_FORMAT, version: FORMAT_VERSION, startedAt: cfg.startedAt },
      ...tapLines(sim, schedule, scanned.ids),
    ]),
    "positions.jsonl": jsonl([
      { type: "header", format: POSITIONS_FORMAT, version: FORMAT_VERSION, startedAt: cfg.startedAt, hz: CAMERA.hz },
      ...positions,
    ]),
  };
  return { config: cfg, files, sim, schedule, room, scan: scanned.scan, ids: scanned.ids };
}
