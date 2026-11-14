/**
 * Simulated devices for the live path: a camera page that sends position
 * reports over the real WebSocket relay, and helpers for saved recordings.
 */
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import WebSocket from "ws";
import type { PositionSample } from "../../src/core";
import { formatReport, validateRunFolder } from "../../tools/world/validator";
import { recordingsDir } from "./ports";

export interface FakeCamera {
  /** Sends the samples at their own times (10 Hz reports), starting now. */
  play(samples: readonly PositionSample[]): void;
  readonly sent: () => number;
  close(): void;
}

export async function connectCamera(port: number): Promise<FakeCamera> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?role=camera`);
  await new Promise<void>((ok, fail) => {
    ws.once("open", () => ok());
    ws.once("error", fail);
  });
  let timer: ReturnType<typeof setInterval> | undefined;
  let sent = 0;
  return {
    play(samples) {
      const start = Date.now();
      let i = 0;
      timer = setInterval(() => {
        const t = (Date.now() - start) / 1000;
        const batch: { workerId: string; x: number; z: number }[] = [];
        while (i < samples.length && samples[i]!.t <= t) {
          const s = samples[i]!;
          batch.push({ workerId: s.workerId, x: s.x, z: s.z });
          i += 1;
        }
        // Latest sample per worker, as the camera page reports.
        const latest = [...new Map(batch.map((b) => [b.workerId, b])).values()];
        if (latest.length > 0 && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ channel: "positions", payload: { type: "report", samples: latest, cameraT: t } }));
          sent += 1;
        }
      }, 100);
    },
    sent: () => sent,
    close() {
      if (timer) clearInterval(timer);
      ws.close();
    },
  };
}

/** Entries saved by the server on `port` since `before`: run folders, and "scans" (posted phone scans). */
export function newEntries(port: number, before: readonly string[]): string[] {
  const dir = recordingsDir(port);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => !n.startsWith(".") && !before.includes(n));
}

/** Run folders saved since `before`. */
export function newRecordings(port: number, before: readonly string[]): string[] {
  return newEntries(port, before).filter((n) => n !== "scans");
}

export function listRecordings(port: number): string[] {
  const dir = recordingsDir(port);
  return existsSync(dir) ? readdirSync(dir).filter((n) => !n.startsWith(".")) : [];
}

/** Runs tools/world/validate.ts's check on a saved recording; returns the report text when it has errors. */
export function validateRecording(port: number, id: string): { readonly ok: boolean; readonly report: string } {
  const dir = join(recordingsDir(port), id);
  const report = validateRunFolder(dir);
  return { ok: report.errors.length === 0, report: formatReport(dir, report) };
}

export function removeRecording(port: number, id: string): void {
  rmSync(join(recordingsDir(port), id), { recursive: true, force: true });
}
