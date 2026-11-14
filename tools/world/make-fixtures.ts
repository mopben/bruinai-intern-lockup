/**
 * npm run fixtures
 *
 * Regenerates fixtures/<run-id>/ for the three staged runs, checks each folder
 * with the validator, and prints a short summary (orders, duration, mean order
 * time, biggest queue at each station) so a person can see the bottleneck.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FILE_NAMES, generateRun } from "./generate";
import { RUNS } from "./runs";
import { formatSummary, summarize } from "./summary";
import { formatReport, validateRunFolder } from "./validator";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "fixtures");

function main(): number {
  const runs = RUNS.map(generateRun);
  let failed = false;
  for (const run of runs) {
    const dir = join(OUT, run.config.id);
    mkdirSync(dir, { recursive: true });
    for (const name of FILE_NAMES) writeFileSync(join(dir, name), run.files[name]);
    const report = validateRunFolder(dir);
    if (report.errors.length > 0 || report.warnings.length > 0) {
      process.stderr.write(formatReport(dir, report));
      failed = failed || report.errors.length > 0;
    }
  }
  process.stdout.write(`Wrote ${runs.length} runs to ${OUT}\n\n`);
  process.stdout.write(formatSummary(runs.map(summarize)));
  process.stdout.write("\nOrder time = order shown on the tablet -> last 'done' tap. Queue = items waiting, not yet started.\n");
  return failed ? 1 : 0;
}

process.exitCode = main();
