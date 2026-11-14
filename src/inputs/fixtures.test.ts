import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRunFiles, RUN_FILES, serialiseRunBundle, type RunFiles } from "./bundle";
import { createManualClock } from "./clock";
import { unwrap } from "./parse";
import { createReplayFeed } from "./replay-feed";

const fixturesDir = resolve(__dirname, "../../fixtures");
const runs = existsSync(fixturesDir)
  ? readdirSync(fixturesDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  : [];

function readRun(id: string): RunFiles {
  return Object.fromEntries(
    Object.values(RUN_FILES).map((name) => [name, readFileSync(join(fixturesDir, id, name), "utf8")]),
  ) as unknown as RunFiles;
}

describe.skipIf(runs.length === 0)("real fixtures", () => {
  it.each(runs)("%s parses, round-trips and replays to the end", (id) => {
    const bundle = unwrap(parseRunFiles(readRun(id), `fixtures/${id}`));
    expect(bundle.meta.id).toBe(id);
    expect(unwrap(parseRunFiles(serialiseRunBundle(bundle)))).toEqual(bundle);

    const feed = createReplayFeed(bundle, { clock: createManualClock() });
    feed.skipToEnd();
    expect(feed.delivered().taps.at(-1)?.type).toBe("end");
    expect(feed.delivered().positions).toHaveLength(bundle.positions.length);
  });
});
