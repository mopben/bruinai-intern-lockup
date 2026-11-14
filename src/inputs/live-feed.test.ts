import { describe, expect, it } from "vitest";
import { createManualClock } from "./clock";
import { createLiveFeed } from "./live-feed";
import type { RunStateMessage } from "./protocol";
import { createLoopbackHub, testLayout, testSetup } from "./test-data";

function setup() {
  const clock = createManualClock();
  const hub = createLoopbackHub();
  const stageLink = hub.link();
  const tablet = hub.link();
  const tabletTaps: unknown[] = [];
  const tabletControl: unknown[] = [];
  tablet.subscribe("taps", (p) => tabletTaps.push(p));
  tablet.subscribe("control", (p) => tabletControl.push(p));
  const feed = createLiveFeed({ link: stageLink, setup: testSetup, workers: testLayout.workers, clock, runId: "r1" });
  const tap = (orderId: string, step: number, tapId = `${orderId}-${step}`) =>
    tablet.send("taps", { type: "tap", tapId, orderId, step, stationId: step === 0 ? "b-till" : "b-make" });
  return { clock, hub, stageLink, tablet, tabletTaps, tabletControl, feed, tap };
}

describe("live feed", () => {
  it("announces the idle run state as soon as it exists", () => {
    const { tabletControl } = setup();
    expect(tabletControl[0]).toMatchObject({ type: "run-state", runId: "r1", status: "idle", events: [] });
  });

  it("releases scheduled orders at their times and broadcasts them", () => {
    const { clock, feed, tabletTaps } = setup();
    feed.start();
    expect(feed.delivered().taps).toEqual([{ type: "order", t: 0, orderId: "o1", itemId: "latte" }]);
    clock.advance(4999);
    expect(feed.delivered().taps).toHaveLength(1);
    clock.advance(1);
    expect(feed.delivered().taps.at(-1)).toEqual({ type: "order", t: 5, orderId: "o2", itemId: "latte" });
    expect(tabletTaps).toContainEqual({ type: "order", t: 5, orderId: "o2", itemId: "latte" });
  });

  it("stamps a tap with stage time on receipt and acks it", () => {
    const { clock, feed, tap, tabletTaps } = setup();
    feed.start();
    clock.advance(2345);
    tap("o1", 0, "tap-1");
    expect(feed.delivered().taps.at(-1)).toEqual({ type: "done", t: 2.345, orderId: "o1", step: 0, stationId: "b-till" });
    expect(tabletTaps.at(-1)).toEqual({ type: "done", t: 2.345, orderId: "o1", step: 0, stationId: "b-till", tapId: "tap-1" });
  });

  it("ignores a resent tap but acks it again", () => {
    const { clock, feed, tap, tabletTaps } = setup();
    feed.start();
    clock.advance(1000);
    tap("o1", 0, "same");
    clock.advance(1000);
    tap("o1", 0, "same");
    expect(feed.delivered().taps.filter((e) => e.type === "done")).toHaveLength(1);
    expect(tabletTaps.filter((m) => (m as { tapId?: string }).tapId === "same")).toHaveLength(2);
  });

  it("rejects impossible taps with a reason", () => {
    const { clock, feed, tap, tabletTaps } = setup();
    tap("o1", 0, "early");
    expect(tabletTaps.at(-1)).toEqual({ type: "tap-rejected", tapId: "early", reason: "the run is not running" });
    feed.start();
    tap("o2", 0, "a");
    expect(tabletTaps.at(-1)).toMatchObject({ type: "tap-rejected", reason: "order o2 is not on the board" });
    tap("o1", 1, "b");
    expect(tabletTaps.at(-1)).toMatchObject({ reason: "order o1: step 0 is not done yet" });
    tap("o1", 5, "c");
    expect(tabletTaps.at(-1)).toMatchObject({ reason: "order o1 has no step 5" });
    tap("o1", 0, "d");
    tap("o1", 0, "e");
    expect(tabletTaps.at(-1)).toMatchObject({ tapId: "e", reason: "order o1 step 0 is already done" });
    expect(feed.delivered().taps.filter((e) => e.type === "done")).toHaveLength(1);
    clock.advance(1);
  });

  it("stamps camera reports and ignores them outside a run", () => {
    const { clock, feed, hub } = setup();
    const camera = hub.link();
    camera.send("positions", { type: "report", samples: [{ workerId: "red", x: 1, z: 2 }] });
    expect(feed.delivered().positions).toEqual([]);
    feed.start();
    clock.advance(1500);
    camera.send("positions", { type: "report", samples: [{ workerId: "red", x: 1, z: 2 }, { workerId: "blue", x: 0, z: 0 }], cameraT: 99 });
    camera.send("positions", { type: "report", samples: [{ workerId: "red", x: "bad" }] });
    expect(feed.delivered().positions).toEqual([
      { type: "pos", t: 1.5, workerId: "red", x: 1, z: 2 },
      { type: "pos", t: 1.5, workerId: "blue", x: 0, z: 0 },
    ]);
  });

  it("answers a sync-request with every event so far", () => {
    const { clock, feed, tap, tablet, tabletControl } = setup();
    feed.start();
    clock.advance(1000);
    tap("o1", 0);
    tablet.send("control", { type: "sync-request", role: "tablet" });
    const state = tabletControl.at(-1) as RunStateMessage;
    expect(state.status).toBe("running");
    expect(state.t).toBe(1);
    expect(state.events).toHaveLength(2);
    expect(state.setup).toEqual(testSetup);
  });

  it("ends by itself when every order is through its last step", () => {
    const { clock, feed, tap, tabletTaps, tablet, tabletControl } = setup();
    const statuses: string[] = [];
    feed.onStatus((s) => statuses.push(s));
    feed.start();
    clock.advance(10_000);
    for (const o of ["o1", "o2", "o3"]) tap(o, 0);
    clock.advance(1000);
    for (const o of ["o1", "o2", "o3"]) tap(o, 1);
    expect(feed.status()).toBe("ended");
    expect(feed.delivered().taps.at(-1)).toEqual({ type: "end", t: 11 });
    expect(tabletTaps.at(-1)).toEqual({ type: "end", t: 11 });
    expect(statuses).toEqual(["running", "ended"]);
    clock.advance(5000);
    expect(feed.now()).toBe(11);
    tablet.send("control", { type: "sync-request", role: "tablet" });
    expect(tabletControl.at(-1)).toMatchObject({ status: "ended" });
  });

  it("stop() ends with one end event and stops releasing orders", () => {
    const { clock, feed } = setup();
    feed.start();
    clock.advance(3000);
    feed.stop();
    feed.stop();
    clock.advance(20_000);
    expect(feed.delivered().taps.map((e) => e.type)).toEqual(["order", "end"]);
    expect(feed.kind).toBe("live");
  });

  it("re-announces state when the link reopens, and dispose detaches", () => {
    const { feed, stageLink, tabletControl } = setup();
    const before = tabletControl.length;
    stageLink.setState("closed");
    stageLink.setState("open");
    expect(tabletControl.length).toBe(before + 1);
    feed.dispose();
    stageLink.setState("closed");
    stageLink.setState("open");
    expect(tabletControl.length).toBe(before + 1);
    expect(feed.linkState()).toBe("open");
  });
});
