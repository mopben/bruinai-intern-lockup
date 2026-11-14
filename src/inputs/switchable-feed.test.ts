import { describe, expect, it } from "vitest";
import type { TapEvent } from "../core/types";
import { createManualClock } from "./clock";
import { createLiveFeed } from "./live-feed";
import { createReplayFeed } from "./replay-feed";
import { createSwitchableFeed, type InputHealth } from "./switchable-feed";
import { createLoopbackHub, testBundle, testLayout, testSetup } from "./test-data";

function rig(autoFailover = true) {
  const clock = createManualClock();
  const hub = createLoopbackHub();
  const stageLink = hub.link();
  const tablet = hub.link();
  const camera = hub.link();
  const live = createLiveFeed({ link: stageLink, setup: testSetup, workers: testLayout.workers, clock });
  const recorded = createReplayFeed(testBundle, { clock });
  const feed = createSwitchableFeed({ live, recorded, clock, link: stageLink, autoFailover, positionsSilenceS: 3 });
  const taps: { e: TapEvent; at: number }[] = [];
  feed.onTap((e) => taps.push({ e, at: clock.now() }));
  const health: (readonly InputHealth[])[] = [];
  feed.onHealth((h) => health.push(h));
  const tap = (orderId: string, step: number) =>
    tablet.send("taps", { type: "tap", tapId: `${orderId}-${step}`, orderId, step, stationId: "x" });
  const sendPos = () => camera.send("positions", { type: "report", samples: [{ workerId: "red", x: 0, z: 0 }] });
  return { clock, stageLink, feed, taps, tap, sendPos, health, live, recorded };
}

const keys = (taps: readonly TapEvent[]) =>
  taps.map((e) => (e.type === "order" ? `order:${e.orderId}` : e.type === "done" ? `done:${e.orderId}#${e.step}` : "end"));

describe("switchable feed", () => {
  it("forwards live taps and live positions only while both are live", () => {
    const { clock, feed, tap, sendPos } = rig();
    feed.start();
    expect(feed.kind).toBe("live");
    clock.advance(1000);
    tap("o1", 0);
    sendPos();
    clock.advance(1000); // replay has o1 step 0 at t=2: must not be delivered again
    expect(keys(feed.delivered().taps)).toEqual(["order:o1", "done:o1#0"]);
    expect(feed.delivered().taps[1]?.t).toBe(1);
    expect(feed.delivered().positions).toEqual([{ type: "pos", t: 1, workerId: "red", x: 0, z: 0 }]);
  });

  it("fails taps over mid-run: each event exactly once, continuing at the right time", () => {
    const { clock, feed, tap, taps } = rig();
    feed.start();
    clock.advance(6000);
    tap("o1", 0); // live done at 6 (replay had it at 2)
    tap("o2", 0); // live done at 6 (replay will have it at 7)
    feed.setSource("taps", "replay");
    clock.advance(60_000);
    expect(keys(feed.delivered().taps)).toEqual([
      "order:o1",
      "order:o2",
      "done:o1#0",
      "done:o2#0",
      "done:o1#1", // replay t=8
      "order:o3", // replay t=10
      "done:o3#0",
      "done:o2#1",
      "done:o3#1",
      "end",
    ]);
    const ts = feed.delivered().taps.map((e) => e.t);
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
    expect(taps.find((x) => x.e.type === "done" && x.e.orderId === "o1" && x.e.step === 1)?.at).toBe(8000);
    expect(feed.status()).toBe("ended");
    expect(feed.delivered().taps.at(-1)).toEqual({ type: "end", t: 22 });
  });

  it("catches up recorded steps missed before the switch, so every order stays complete", () => {
    const { clock, feed, tap } = rig();
    feed.start();
    clock.advance(7500); // live: o1, o2 released; nobody tapped. Recording: o1#0 at 2, o2#0 at 7.
    tap("o1", 0); // live done o1#0 at 7.5
    feed.setSource("taps", "replay");
    expect(keys(feed.delivered().taps)).toEqual(["order:o1", "order:o2", "done:o1#0", "done:o2#0"]);
    expect(feed.delivered().taps.at(-1)?.t).toBe(7); // recorded time kept
    clock.advance(60_000);
    const doneKeys = keys(feed.delivered().taps).filter((k) => k.startsWith("done"));
    expect(doneKeys.sort()).toEqual(["done:o1#0", "done:o1#1", "done:o2#0", "done:o2#1", "done:o3#0", "done:o3#1"]);
    expect(new Set(keys(feed.delivered().taps)).size).toBe(feed.delivered().taps.length);
  });

  it("does not re-release an order the live feed already released", () => {
    const { clock, feed } = rig();
    feed.start();
    clock.advance(4000);
    feed.setSource("taps", "replay");
    clock.advance(1000);
    feed.setSource("taps", "live");
    clock.advance(500);
    // o1#0 came from the recording's catch-up; o2 was released once only.
    expect(keys(feed.delivered().taps)).toEqual(["order:o1", "done:o1#0", "order:o2"]);
  });

  it("positions failing does not touch live taps (watchdog fires, auto failover)", () => {
    const { clock, feed, tap, sendPos, health } = rig();
    feed.start();
    sendPos();
    clock.advance(2000);
    sendPos();
    clock.advance(2900);
    expect(feed.health().every((h) => h.state === "ok")).toBe(true);
    clock.advance(500); // 3.4 s without a sample
    expect(feed.sources()).toEqual({ taps: "live", positions: "replay" });
    expect(health.at(-1)?.find((h) => h.input === "positions")).toMatchObject({
      state: "replaced",
      source: "replay",
      reason: "no camera positions for 3 s",
    });
    expect(feed.health().find((h) => h.input === "taps")?.state).toBe("ok");
    const before = feed.delivered().positions.length;
    clock.advance(1000);
    expect(feed.delivered().positions.length).toBe(before + 2); // replay's samples at t=6
    expect(feed.delivered().positions.at(-1)?.t).toBe(6);
    tap("o1", 0);
    expect(feed.delivered().taps.at(-1)).toMatchObject({ type: "done", orderId: "o1", t: 6.4 });
  });

  it("without autoFailover reports degraded and waits for the operator", () => {
    const { clock, feed, health } = rig(false);
    feed.start();
    clock.advance(3500);
    expect(feed.sources().positions).toBe("live");
    expect(health.at(-1)?.find((h) => h.input === "positions")?.state).toBe("degraded");
    feed.setSource("positions", "replay");
    expect(feed.health().find((h) => h.input === "positions")?.state).toBe("replaced");
    feed.setSource("positions", "live");
    expect(feed.health().find((h) => h.input === "positions")?.state).toBe("ok");
  });

  it("a closed link degrades both inputs and fails both over", () => {
    const { clock, feed, stageLink, sendPos } = rig();
    feed.start();
    for (let i = 0; i < 4; i += 1) {
      sendPos();
      clock.advance(500);
    }
    stageLink.setState("closed");
    clock.advance(1900);
    expect(feed.sources()).toEqual({ taps: "live", positions: "live" });
    clock.advance(400);
    expect(feed.sources()).toEqual({ taps: "replay", positions: "replay" });
    expect(feed.health()[0]?.reason).toMatch(/lost the connection/);
    expect(feed.kind).toBe("replay");
    clock.advance(60_000);
    expect(feed.status()).toBe("ended");
    expect(keys(feed.delivered().taps).filter((k) => k === "end")).toHaveLength(1);
  });

  it("stop() ends everything once", () => {
    const { clock, feed, live, recorded } = rig();
    feed.start();
    clock.advance(3000);
    feed.stop();
    feed.stop();
    expect(feed.delivered().taps.at(-1)).toEqual({ type: "end", t: 3 });
    expect(live.status()).toBe("ended");
    expect(recorded.status()).toBe("ended");
    expect(feed.now()).toBe(3);
  });

  it("switching taps to a recording that already ended ends the run", () => {
    const { clock, feed } = rig();
    feed.start();
    clock.advance(30_000);
    feed.setSource("taps", "replay");
    expect(feed.status()).toBe("ended");
  });
});
