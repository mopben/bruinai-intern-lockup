/**
 * The scan input, live or replayed, behind one interface.
 *
 * - replay: resolves with a scan from a file (a URL, file text, or a Scan).
 * - live: resolves when the phone POSTs /api/scan (the server broadcasts it on
 *   channel "scan"), or when the operator drops a scan.json onto the stage.
 */
import type { Scan } from "../core/types";
import { createEmitter } from "./feed";
import { InputFormatError, parseScan, unwrap, type ParseResult } from "./parse";
import { scanMessageSchema } from "./protocol";
import type { MessageLink, Unsubscribe } from "./socket";

export interface ScanFeed {
  readonly kind: "live" | "replay";
  /** Resolves with the first scan (or the latest one, if one already arrived). */
  waitForScan(): Promise<Scan>;
  latest(): Scan | undefined;
  /** Every scan from now on (a second phone scan replaces the first). */
  onScan(listener: (scan: Scan) => void): Unsubscribe;
  /** Offers a scan.json the operator dropped or picked. Rejected text leaves the feed unchanged. */
  offerFile(text: string, fileName?: string): ParseResult<Scan>;
  close(): void;
}

function createScanCore(kind: ScanFeed["kind"]) {
  const scans = createEmitter<Scan>();
  let latest: Scan | undefined;
  let waiters: readonly ((scan: Scan) => void)[] = [];

  const accept = (scan: Scan) => {
    latest = scan;
    const toResolve = waiters;
    waiters = [];
    toResolve.forEach((resolve) => resolve(scan));
    scans.emit(scan);
  };

  const feed: Omit<ScanFeed, "close"> = {
    kind,
    waitForScan: () =>
      latest !== undefined
        ? Promise.resolve(latest)
        : new Promise<Scan>((resolve) => {
            waiters = [...waiters, resolve];
          }),
    latest: () => latest,
    onScan: scans.add,
    offerFile(text, fileName = "scan.json") {
      const parsed = parseScan(text, fileName);
      if (parsed.ok) accept(parsed.value);
      return parsed;
    },
  };
  return { feed, accept };
}

type FetchLike = (input: string) => Promise<Response>;

/** Replay from a Scan, or from a URL such as "/fixtures/counter-a/scan.json". */
export function createReplayScanFeed(source: Scan | string, fetchImpl: FetchLike = (u) => fetch(u)): ScanFeed {
  const { feed, accept } = createScanCore("replay");
  let loading: Promise<Scan> | undefined;
  const load = async (): Promise<Scan> => {
    if (typeof source !== "string") return source;
    const response = await fetchImpl(source).catch((error: unknown) => {
      throw new InputFormatError(`Could not reach ${source} (${error instanceof Error ? error.message : String(error)})`);
    });
    if (!response.ok) throw new InputFormatError(`Could not load ${source} (HTTP ${response.status})`);
    return unwrap(parseScan(await response.text(), source));
  };
  return {
    ...feed,
    waitForScan() {
      const existing = feed.latest();
      if (existing !== undefined) return Promise.resolve(existing);
      loading ??= load().then((scan) => {
        accept(scan);
        return scan;
      });
      return loading;
    },
    close: () => undefined,
  };
}

/** Live from the phone, via the server's "scan" channel. */
export function createLiveScanFeed(link: Pick<MessageLink, "subscribe">): ScanFeed {
  const { feed, accept } = createScanCore("live");
  const off = link.subscribe("scan", (payload) => {
    const parsed = scanMessageSchema.safeParse(payload);
    if (parsed.success) accept(parsed.data.scan);
  });
  return { ...feed, close: off };
}
