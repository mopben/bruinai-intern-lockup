/**
 * The people in the staged room and how they work. These numbers are the
 * world's secret: the model never reads them, it only sees the logs.
 */
import { clippedNormal, lognormal, normal, uniform, type Rng } from "./rng";

export interface Person {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  /** Cruising walking speed, m/s. */
  readonly speed: number;
  /** Speeding up and slowing down, m/s^2. */
  readonly accel: number;
  readonly decel: number;
  /** Multiplies every work time (below 1 is quicker than average). */
  readonly skill: number;
  /** Median pause between finishing and tapping "done", s. */
  readonly tapDelay: number;
  /** Chance that a step is fumbled (dropped lid, wrong cup) and takes much longer. */
  readonly fumbleChance: number;
  /** Idle sway at the station: amplitude in m, frequency in Hz, phases. */
  readonly swayAmp: number;
  readonly swayHz: number;
  readonly swayPhase: readonly [number, number];
  /** Where this person habitually stands, relative to the stand point, m. */
  readonly habit: { readonly along: number; readonly out: number };
}

/** Station work times: lognormal median (s) and log-space spread. */
export interface WorkTime {
  readonly median: number;
  readonly sigma: number;
}

export interface WorldParams {
  readonly work: Readonly<Record<string, WorkTime>>;
  /** Opening the fridge, taking the milk jug out, closing it. */
  readonly fridgeHandling: WorkTime;
  /** Passing an item by hand (neighbour within reach). */
  readonly handPass: number;
  /** Putting a carried item down. */
  readonly putDown: number;
  /** Time to notice a new item before starting it: uniform range, s. */
  readonly notice: readonly [number, number];
  /** Fumble: work time multiplied by a factor in this range. */
  readonly fumbleFactor: readonly [number, number];
}

export const WORLD: WorldParams = {
  work: {
    order: { median: 1.6, sigma: 0.25 },
    make: { median: 1.45, sigma: 0.2 },
    finish: { median: 1.5, sigma: 0.25 },
  },
  fridgeHandling: { median: 0.5, sigma: 0.3 },
  handPass: 0.25,
  putDown: 0.3,
  notice: [0.1, 0.4],
  fumbleFactor: [1.7, 2.4],
};

export interface PersonSeed {
  readonly id: string;
  readonly name: string;
  readonly color: string;
}

/** Hat colours far apart in hue (red ~355, yellow ~48, green ~140, blue ~215) for the colour tracker. */
export const CREW: readonly PersonSeed[] = [
  { id: "red", name: "Ana", color: "#e8312f" },
  { id: "blue", name: "Ben", color: "#1f6fe0" },
  { id: "yellow", name: "Cleo", color: "#f5c400" },
  { id: "green", name: "Dev", color: "#1fa84f" },
];

/** Draws a person's lasting traits. Use the same stream for the same people across runs. */
export function drawPerson(rng: Rng, seed: PersonSeed): Person {
  return {
    ...seed,
    speed: clippedNormal(rng, 1.15, 0.07, 1.0, 1.3),
    accel: uniform(rng, 1.3, 1.9),
    decel: uniform(rng, 1.5, 2.1),
    skill: lognormal(rng, 1, 0.08),
    tapDelay: uniform(rng, 0.25, 0.45),
    fumbleChance: uniform(rng, 0.04, 0.08),
    swayAmp: uniform(rng, 0.015, 0.03),
    swayHz: uniform(rng, 0.15, 0.35),
    swayPhase: [uniform(rng, 0, 2 * Math.PI), uniform(rng, 0, 2 * Math.PI)],
    habit: { along: normal(rng, 0, 0.03), out: clippedNormal(rng, 0, 0.02, -0.04, 0.04) },
  };
}

/** Same person on another day: a little faster or slower overall. */
export function onTheDay(rng: Rng, p: Person): Person {
  const pace = clippedNormal(rng, 1, 0.03, 0.94, 1.06);
  return { ...p, speed: Math.min(1.32, p.speed * pace), skill: p.skill / pace };
}
