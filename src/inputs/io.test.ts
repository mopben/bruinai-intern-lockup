import { describe, expect, it } from "vitest";
import { listFixtures, loadRunBundle, fetchServerInfo } from "./api";
import { serialiseRunBundle } from "./bundle";
import { createManualClock } from "./clock";
import { createReplayFeed } from "./replay-feed";
import { InputFormatError } from "./parse";
import { watchPresence } from "./presence";
import { bundleFromFeed, recordingId, saveRecording } from "./recording";
import { createLiveScanFeed, createReplayScanFeed } from "./scan-feed";
import { createReconnectingSocket, defaultSocketUrl, type WebSocketLike } from "./socket";
import { createLoopbackHub, testBundle, testScan } from "./test-data";

const files = serialiseRunBundle(testBundle) as Record<string, string>;

function fakeFetch(routes: Record<string, { status?: number; body: string }>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const route = routes[url];
    if (route === undefined) return new Response("nope", { status: 404 });
    return new Response(route.body, { status: route.status ?? 200 });
  };
  return { impl, calls };
}

describe("loading runs", () => {
  it("loads a run folder through the schemas", async () => {
    const routes = Object.fromEntries(Object.entries(files).map(([name, body]) => [`/fixtures/t/${name}`, { body }]));
    const { impl } = fakeFetch(routes);
    expect(await loadRunBundle("/fixtures/t", impl)).toEqual(testBundle);
  });

  it("says which file could not be loaded", async () => {
    const { impl } = fakeFetch({});
    await expect(loadRunBundle("/fixtures/none/", impl)).rejects.toThrow("Could not load /fixtures/none/run.json (HTTP 404)");
    await expect(loadRunBundle("/x/", () => Promise.reject(new Error("offline")))).rejects.toThrow(/Could not reach .*offline/);
  });

  it("names the file and line of bad data", async () => {
    const routes = Object.fromEntries(Object.entries(files).map(([name, body]) => [`/r/${name}`, { body }]));
    routes["/r/positions.jsonl"] = { body: `${files["positions.jsonl"]}{"type":"pos"}\n` };
    const { impl } = fakeFetch(routes);
    const error = await loadRunBundle("/r/", impl).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InputFormatError);
    expect((error as Error).message).toMatch(/^\/r\/positions\.jsonl line 48: field "t" is missing/);
  });

  it("lists fixtures and reads server info through the envelope", async () => {
    const { impl } = fakeFetch({
      "/api/fixtures": { body: JSON.stringify({ success: true, data: [{ id: "a", origin: "fixtures", url: "/fixtures/a/" }] }) },
      "/api/info": { status: 500, body: JSON.stringify({ success: false, error: "boom" }) },
    });
    expect(await listFixtures(impl)).toEqual([{ id: "a", origin: "fixtures", url: "/fixtures/a/" }]);
    await expect(fetchServerInfo(impl)).rejects.toThrow("Reading server info: boom");
    const html = fakeFetch({ "/api/info": { body: "<html>" } });
    await expect(fetchServerInfo(html.impl)).rejects.toThrow(/not JSON/);
    const odd = fakeFetch({ "/api/info": { body: "[1]" } });
    await expect(fetchServerInfo(odd.impl)).rejects.toThrow(/unexpected reply/);
  });
});

describe("recording", () => {
  it("builds a bundle in fixture format and closes it with an end", () => {
    const clock = createManualClock();
    const feed = createReplayFeed(testBundle, { clock });
    feed.start();
    clock.advance(7500);
    const at = new Date(2026, 10, 14, 9, 5, 3);
    const bundle = bundleFromFeed(feed, { scan: testScan, setup: testBundle.setup, layout: testBundle.layout, title: "Team run", recordedAt: at, baseRunId: "counter-a", change: "none" });
    expect(bundle.meta).toMatchObject({ id: "rec-20261114-090503", source: "recorded", baseRunId: "counter-a", change: "none" });
    expect(bundle.taps.at(-1)).toEqual({ type: "end", t: 7.5 });
    expect(bundle.taps.filter((e) => e.type === "end")).toHaveLength(1);
    expect(recordingId(at)).toBe("rec-20261114-090503");
  });

  it("labels a run whose inputs were partly replayed", () => {
    const feed = createReplayFeed(testBundle, { clock: createManualClock() });
    feed.skipToEnd();
    const health = () => [
      { input: "taps" as const, source: "live" as const, state: "ok" as const },
      { input: "positions" as const, source: "replay" as const, state: "replaced" as const, reason: "x" },
    ];
    const ctx = { scan: testScan, setup: testBundle.setup, layout: testBundle.layout, title: "Run 2" };
    expect(bundleFromFeed({ ...feed, delivered: feed.delivered, now: feed.now, health }, ctx).meta.title).toBe(
      "Run 2 (positions partly from the recording)",
    );
    expect(bundleFromFeed(feed, ctx).meta.title).toBe("Run 2");
  });

  it("posts the bundle to /api/recordings", async () => {
    const { impl, calls } = fakeFetch({
      "/api/recordings": { body: JSON.stringify({ success: true, data: { id: "x", url: "/recordings/x/" } }) },
    });
    const feed = createReplayFeed(testBundle, { clock: createManualClock() });
    feed.skipToEnd();
    const receipt = await saveRecording(feed, { scan: testScan, setup: testBundle.setup, layout: testBundle.layout, title: "t", id: "x" }, impl);
    expect(receipt).toEqual({ id: "x", url: "/recordings/x/" });
    const sent = JSON.parse(String(calls[0]?.init?.body)) as typeof testBundle;
    expect(sent.taps).toEqual(testBundle.taps);
    expect(calls[0]?.init?.method).toBe("POST");
  });
});

describe("scan feeds", () => {
  it("replay resolves from a Scan or a URL, once", async () => {
    expect(await createReplayScanFeed(testScan).waitForScan()).toEqual(testScan);
    const { impl, calls } = fakeFetch({ "/s.json": { body: JSON.stringify(testScan) } });
    const feed = createReplayScanFeed("/s.json", impl);
    const seen: unknown[] = [];
    feed.onScan((s) => seen.push(s));
    expect(await feed.waitForScan()).toEqual(testScan);
    expect(await feed.waitForScan()).toEqual(testScan);
    expect(calls).toHaveLength(1);
    expect(seen).toHaveLength(1);
    expect(feed.kind).toBe("replay");
  });

  it("replay reports a bad scan file plainly", async () => {
    const { impl } = fakeFetch({ "/bad.json": { body: "{}" } });
    await expect(createReplayScanFeed("/bad.json", impl).waitForScan()).rejects.toThrow(/^\/bad\.json: field "format"/);
    await expect(createReplayScanFeed("/missing.json", impl).waitForScan()).rejects.toThrow(/HTTP 404/);
  });

  it("live resolves when the server broadcasts a scan, and accepts dropped files", async () => {
    const hub = createLoopbackHub();
    const stage = hub.link();
    const server = hub.link();
    const feed = createLiveScanFeed(stage);
    const waiting = feed.waitForScan();
    server.send("scan", { type: "scan", scan: { nope: 1 }, receivedAt: "x" });
    expect(feed.latest()).toBeUndefined();
    server.send("scan", { type: "scan", scan: testScan, receivedAt: "2026-11-14T00:00:00Z" });
    expect(await waiting).toEqual(testScan);
    expect(feed.offerFile("{bad").ok).toBe(false);
    const second = { ...testScan, device: "iPad" };
    expect(feed.offerFile(JSON.stringify(second)).ok).toBe(true);
    expect(feed.latest()).toEqual(second);
    feed.close();
    server.send("scan", { type: "scan", scan: testScan, receivedAt: "x" });
    expect(feed.latest()).toEqual(second);
  });
});

describe("presence", () => {
  it("passes role counts from the server", () => {
    const hub = createLoopbackHub();
    const stage = hub.link();
    const server = hub.link();
    const seen: unknown[] = [];
    watchPresence(stage, (r) => seen.push(r));
    server.send("control", { type: "presence", roles: { stage: 1, tablet: 2, camera: 0, other: 0 } });
    server.send("control", { type: "sync-request", role: "tablet" });
    expect(seen).toEqual([{ stage: 1, tablet: 2, camera: 0, other: 0 }]);
  });
});

class FakeSocket implements WebSocketLike {
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
    this.onclose?.({});
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
}

describe("reconnecting socket", () => {
  it("connects, delivers envelopes by channel, and reconnects with backoff", () => {
    FakeSocket.all = [];
    const clock = createManualClock();
    const link = createReconnectingSocket({ url: "ws://h/ws?role=tablet", role: "tablet", clock, createSocket: (u) => new FakeSocket(u), minDelayMs: 100, maxDelayMs: 400 });
    const states: string[] = [];
    link.onState((s) => states.push(s));
    const got: unknown[] = [];
    link.subscribe("taps", (p) => got.push(p));
    expect(link.send("taps", 1)).toBe(false);
    const first = FakeSocket.all[0] as FakeSocket;
    first.open();
    expect(link.send("taps", { a: 1 })).toBe(true);
    expect(first.sent).toEqual(['{"channel":"taps","payload":{"a":1}}']);
    first.onmessage?.({ data: '{"channel":"taps","payload":7}' });
    first.onmessage?.({ data: '{"channel":"nope","payload":7}' });
    first.onmessage?.({ data: "garbage" });
    first.onmessage?.({ data: 42 });
    expect(got).toEqual([7]);

    first.close();
    expect(link.state()).toBe("closed");
    clock.advance(99);
    expect(FakeSocket.all).toHaveLength(1);
    clock.advance(1);
    expect(FakeSocket.all).toHaveLength(2);
    FakeSocket.all[1]?.close();
    clock.advance(199);
    expect(FakeSocket.all).toHaveLength(2);
    clock.advance(1);
    expect(FakeSocket.all).toHaveLength(3);
    FakeSocket.all[2]?.open();
    expect(states).toEqual(["open", "closed", "connecting", "closed", "connecting", "open"]);

    link.close();
    clock.advance(10_000);
    expect(FakeSocket.all).toHaveLength(3);
    expect(link.state()).toBe("closed");
  });

  it("retries when the socket cannot even be created", () => {
    const clock = createManualClock();
    let attempts = 0;
    const link = createReconnectingSocket({
      role: "stage",
      url: "ws://x",
      clock,
      minDelayMs: 10,
      createSocket: () => {
        attempts += 1;
        throw new Error("no");
      },
    });
    clock.advance(10);
    expect(attempts).toBe(2);
    link.close();
  });

  it("builds the default URL from the page location", () => {
    expect(defaultSocketUrl("camera")).toMatch(/^ws:\/\/.+\/ws\?role=camera$/);
  });
});
