/**
 * Speed of `predict` on the counter-a fixture: calibrated on counter-a, predicted on
 * the same layout with the default replications, as the stage does on a drag frame.
 * Times CALLS calls after WARMUP untimed ones and prints milliseconds per call.
 *
 *   npx tsx tools/coverage/bench.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calibrate, predict, reconstructRun, resolveWorld, type Layout, type PositionSample, type Scan, type Setup, type TapEvent } from "../../src/core/index";

const CALLS = 2000;
const WARMUP = 50;
const FIXTURE = join(import.meta.dirname, "..", "..", "fixtures", "counter-a");

function jsonl<T>(text: string): T[] {
  return text
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as { type: string })
    .filter((l) => l.type !== "header") as T[];
}

function main(): void {
  const read = (f: string): string => readFileSync(join(FIXTURE, f), "utf8");
  const setup = JSON.parse(read("setup.json")) as Setup;
  const world = resolveWorld(JSON.parse(read("scan.json")) as Scan, setup, JSON.parse(read("layout.json")) as Layout);
  const cal = calibrate(world, reconstructRun(setup, jsonl<TapEvent>(read("taps.jsonl"))), jsonl<PositionSample>(read("positions.jsonl")));
  for (let i = 0; i < WARMUP; i += 1) predict(world, cal);
  const t0 = performance.now();
  for (let i = 0; i < CALLS; i += 1) predict(world, cal);
  const perCall = (performance.now() - t0) / CALLS;
  console.log(`predict on counter-a: ${perCall.toFixed(3)} ms per call (${CALLS} calls)`);
}

main();
