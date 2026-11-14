/**
 * The three staged runs. Seeds are fixed so the fixtures are reproducible.
 *
 * People are drawn once from PEOPLE_SEED: the same four people work every run
 * (with a little day-to-day variation from each run's own seed). The scan is
 * taken once, of the original room, and reused; a changed run moves a box in
 * layout.json, as dragging it in the product would.
 */
import type { Rect } from "./geometry";
import { FRIDGE_CLOSE, FRIDGE_FAR } from "./room";
import type { StationKey } from "./sim";

export const PEOPLE_SEED = 4242;
export const SCAN_SEED = 9090;
export const SCHEDULE_SEED = 777;
export const SCAN_CAPTURED_AT = "2026-11-12T15:02:41Z";

export interface RunConfig {
  readonly id: string;
  readonly title: string;
  readonly change?: string;
  readonly baseRunId?: string;
  readonly seed: number;
  readonly startedAt: string;
  readonly fridge: Rect;
  readonly crew: readonly { readonly personId: string; readonly station: StationKey }[];
}

const CREW_3 = [
  { personId: "red", station: "order" },
  { personId: "blue", station: "make" },
  { personId: "yellow", station: "finish" },
] as const;

export const RUNS: readonly RunConfig[] = [
  {
    id: "counter-a",
    title: "Original counter",
    seed: 1101,
    startedAt: "2026-11-12T15:10:05.000Z",
    fridge: FRIDGE_FAR,
    crew: CREW_3,
  },
  {
    id: "counter-b-fridge-closer",
    title: "Fridge next to the espresso machine",
    change: "The milk fridge moved from the left wall to just behind the espresso machine worker.",
    baseRunId: "counter-a",
    seed: 2202,
    startedAt: "2026-11-12T15:17:40.000Z",
    fridge: FRIDGE_CLOSE,
    crew: CREW_3,
  },
  {
    id: "counter-c-fourth-worker",
    title: "A fourth worker at the espresso machine",
    change: "A fourth worker (green hat) joined the espresso machine. The layout did not change.",
    baseRunId: "counter-a",
    seed: 3303,
    startedAt: "2026-11-12T15:24:12.000Z",
    fridge: FRIDGE_FAR,
    crew: [...CREW_3, { personId: "green", station: "make" }],
  },
];

/** ~10 orders, about one every 6 s, with a little jitter. Same for every run. */
export const SCHEDULE_SPEC = { count: 10, first: 0.9, every: 6, jitter: 0.7 } as const;
