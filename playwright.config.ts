/**
 * The acceptance test: `npm run acceptance`.
 *
 * Two copies of the real server, started by the real one command
 * (`node tools/start.mjs --no-open`, which builds first if needed), on ports
 * of their own so the suite can run while someone has the app open on 5179:
 *
 *   REPLAY (5191)  replay-mode tests, in parallel.
 *   LIVE   (5192)  live-path tests, one file, one at a time: the server relays
 *                  every message to every client, so two live stages, tablets
 *                  or cameras at once would see each other.
 *
 * Fixtures only. Every test blocks requests to anything but localhost and
 * fails if one is attempted (e2e/support/fixtures.ts). Recordings go to temp
 * folders (DRYRUN_RECORDINGS), never to the repo's recordings/.
 */
import { defineConfig, devices } from "@playwright/test";
import { LIVE_PORT, REPLAY_PORT, recordingsDir } from "./e2e/support/ports";

/**
 * DRYRUN_E2E_OFFLINE=1: also cut the browser off from the network for real,
 * through a proxy that does not exist; only localhost bypasses it.
 */
const OFFLINE_ARGS = process.env.DRYRUN_E2E_OFFLINE === "1" ? ["--proxy-server=http://127.0.0.1:9", "--proxy-bypass-list=localhost;127.0.0.1"] : [];

const server = (port: number) => ({
  command: "node tools/start.mjs --no-open",
  url: `http://127.0.0.1:${port}/api/info`,
  reuseExistingServer: false,
  timeout: 240_000,
  stdout: "ignore" as const,
  stderr: "pipe" as const,
  env: { PORT: String(port), DRYRUN_NO_OPEN: "1", DRYRUN_RECORDINGS: recordingsDir(port), DRYRUN_LOG_LEVEL: "warn" },
});

export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results",
  fullyParallel: false,
  workers: 4,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    trace: "retain-on-failure",
    launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", ...OFFLINE_ARGS] },
  },
  // Sequential: the first builds if needed, the second then finds the build up to date.
  webServer: [server(REPLAY_PORT), server(LIVE_PORT)],
  projects: [{ name: "chromium" }],
});
