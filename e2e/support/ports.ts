/** Ports and temp folders of the two test servers (see playwright.config.ts). */
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Replay-mode tests. Not 5179, so the suite can run beside an open demo. */
export const REPLAY_PORT = 5191;
/** Live-path tests (tablet, camera, phone scan), one at a time. */
export const LIVE_PORT = 5192;

/** Where the server on `port` saves recordings during the suite. Never the repo's recordings/. */
export function recordingsDir(port: number): string {
  return join(tmpdir(), `dryrun-acceptance-recordings-${port}`);
}

export const origin = (port: number): string => `http://localhost:${port}`;
