/**
 * URL parameters of the stage page. Pure: takes the query string.
 *
 *   ?run=counter-a      base run (a fixture or recording id). Default counter-a.
 *   &mode=replay|live   replay (default): every input from the recording.
 *                       live: scan, taps and positions start on live.
 *   &speed=4            replay speed for every playback (default 1, 0.25 to 64).
 *   &step=1..5          step to open on (default 1). 6, the old Compare step, opens Test.
 */
import { stepAt, type StepId } from "./steps";

export type Mode = "replay" | "live";

export interface StageParams {
  readonly runId: string;
  readonly mode: Mode;
  readonly speed: number;
  readonly step: StepId;
}

export const DEFAULT_RUN_ID = "counter-a";
const MIN_SPEED = 0.25;
const MAX_SPEED = 64;
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function parseParams(search: string): StageParams {
  const q = new URLSearchParams(search);
  const run = q.get("run") ?? "";
  const speed = Number(q.get("speed") ?? "1");
  const step = Number(q.get("step") ?? "1");
  return {
    runId: SAFE_ID.test(run) ? run : DEFAULT_RUN_ID,
    mode: q.get("mode") === "live" ? "live" : "replay",
    speed: Number.isFinite(speed) && speed >= MIN_SPEED && speed <= MAX_SPEED ? speed : 1,
    step: Number.isInteger(step) ? stepAt(step - 1) : "scan",
  };
}
