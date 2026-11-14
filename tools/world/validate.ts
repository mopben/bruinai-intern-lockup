/**
 * Check a run folder before loading it into Dry Run.
 *
 *   npx tsx tools/world/validate.ts fixtures/counter-a
 *   npx tsx tools/world/validate.ts recordings/my-run another-folder
 *
 * Prints what is wrong in plain words. Exit code 1 if any folder has errors.
 */
import { resolve } from "node:path";
import { formatReport, validateRunFolder } from "./validator";

const dirs = process.argv.slice(2);
if (dirs.length === 0) {
  process.stderr.write("Usage: npx tsx tools/world/validate.ts <run-folder> [more folders]\n");
  process.exitCode = 2;
} else {
  const reports = dirs.map((d) => ({ d, report: validateRunFolder(resolve(d)) }));
  for (const { d, report } of reports) process.stdout.write(formatReport(d, report) + "\n");
  process.exitCode = reports.some((r) => r.report.errors.length > 0) ? 1 : 0;
}
