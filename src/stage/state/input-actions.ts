/**
 * Switching each input between live and recorded, at any time, without a
 * reload and without leaving the step. Also the phone scan and a dropped scan.json.
 */
import { batch } from "@preact/signals";
import { parseScan } from "../../inputs";
import { acceptLiveScan, useRecordedKitchen, waitForLiveScan } from "./kitchen-actions";
import { liveScanFeed } from "./link";
import { currentPlayer, liveSwitchable } from "./runs";
import { addNotice, dropNotice, latestLiveScan, sources, step, type InputKind, type Source } from "./store";

export function setSource(input: InputKind, source: Source): void {
  if (sources.value[input] === source) return;
  batch(() => {
    sources.value = { ...sources.value, [input]: source };
    if (input === "taps") dropNotice("notablet");
  });
  if (input === "scan") {
    if (source === "replay") useRecordedKitchen(step.value === "scan");
    else waitForLiveScan();
    return;
  }
  const sw = liveSwitchable();
  if (sw && sw.status() !== "ended") {
    sw.setSource(input, source);
    return;
  }
  const p = currentPlayer();
  if (p && p.feed.status() === "running") {
    addNotice({ id: `next-${input}`, text: `The ${input} switch applies when the next run starts.`, tone: "calm" });
  }
}

/** A scan.json dropped anywhere on the stage. */
export function acceptDroppedScan(text: string, fileName: string): void {
  const parsed = parseScan(text, fileName);
  if (!parsed.ok) {
    addNotice({ id: "drop", text: `That file is not a scan we can read. ${parsed.error}`, tone: "warn" });
    return;
  }
  batch(() => {
    dropNotice("drop");
    sources.value = { ...sources.value, scan: "live" };
  });
  const feed = liveScanFeed();
  // With a feed, offerFile announces the scan to watchScans, which accepts it.
  if (feed) feed.offerFile(text, fileName);
  else acceptLiveScan(parsed.value);
}

/** Scans from the phone (via the server) or from a dropped file. */
export function watchScans(): void {
  const feed = liveScanFeed();
  if (!feed) return;
  feed.onScan((scan) => {
    if (sources.value.scan === "live") {
      acceptLiveScan(scan);
      return;
    }
    latestLiveScan.value = scan;
    addNotice({ id: "phone-scan", text: "A new scan arrived from the phone. Press I and switch the scan to live to use it.", tone: "calm" });
  });
}
