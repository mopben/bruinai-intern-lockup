import { describe, expect, it } from "vitest";
import type { PositionSample, TapEvent } from "../core/types";
import { createManualClock } from "./clock";
import { createReplayFeed } from "./replay-feed";
import { testBundle } from "./test-data";

function record(feed: ReturnType<typeof createReplayFeed>, clock: ReturnType<typeof createManualClock>) {
  const taps: { e: TapEvent; at: number }[] = [];
  const positions: PositionSample[] = [];
  feed.onTap((e) => taps.push({ e, at: clock.now() }));
  feed.onPosition((p) => positions.push(p));
  return { taps, positions };
}

describe("replay feed", () => {
  it("delivers every event once, in order, at its time", () => {
    const clock = createManualClock();
    const feed = createReplayFeed(testBundle, { clock });
    const got = record(feed, clock);
    expect(feed.status()).toBe("idle");
    feed.start();
    expect(got.taps.map((x) => x.e)).toEqual([testBundle.taps[0]]);
    clock.advance(1999);
    expect(got.taps).toHaveLength(1);
    clock.advance(1);
    expect(got.taps).toHaveLength(2);
    expect(got.taps[1]?.at).toBe(2000);
    expect(feed.now()).toBe(2);
    clock.advance(30_000);
    expect(got.taps.map((x) => x.e)).toEqual(testBundle.taps);
    expect(got.taps.every((x) => x.at === x.e.t * 1000)).toBe(true);
    expect(got.positions).toEqual(testBundle.positions);
    expect(feed.status()).toBe("ended");
    expect(feed.now()).toBe(22);
    expect(feed.delivered().taps).toEqual(testBundle.taps);
    expect(clock.pending()).toBe(0);
  });

  it("plays faster at 4x", () => {
    const clock = createManualClock();
    const feed = createReplayFeed(testBundle, { clock, speed: 4 });
    const got = record(feed, clock);
    feed.start();
    clock.advance(2000); // 8 s of run time
    expect(feed.now()).toBe(8);
    expect(got.taps.map((x) => x.e.t)).toEqual([0, 2, 5, 7, 8]);
    clock.advance(3500);
    expect(feed.status()).toBe("ended");
  });

  it("changes speed mid-run without a jump", () => {
    const clock = createManualClock();
    const feed = createReplayFeed(testBundle, { clock });
    feed.start();
    clock.advance(4000);
    feed.setSpeed(2);
    expect(feed.now()).toBe(4);
    clock.advance(1000);
    expect(feed.now()).toBe(6);
    expect(() => feed.setSpeed(0)).toThrow(RangeError);
  });

  it("pauses and resumes", () => {
    const clock = createManualClock();
    const feed = createReplayFeed(testBundle, { clock });
    const got = record(feed, clock);
    feed.start();
    clock.advance(3000);
    feed.pause();
    expect(feed.isPaused()).toBe(true);
    clock.advance(60_000);
    expect(feed.now()).toBe(3);
    expect(got.taps).toHaveLength(2);
    feed.resume();
    clock.advance(2000);
    expect(feed.now()).toBe(5);
    expect(got.taps).toHaveLength(3);
  });

  it("seeks forward delivering everything skipped, in order, without duplicates", () => {
    const clock = createManualClock();
    const feed = createReplayFeed(testBundle, { clock });
    const got = record(feed, clock);
    feed.start();
    clock.advance(1000);
    feed.seek(10);
    expect(got.taps.map((x) => x.e)).toEqual(testBundle.taps.slice(0, 6));
    feed.seek(3); // backwards: ignored
    expect(feed.now()).toBe(10);
    clock.advance(2000);
    expect(got.taps.map((x) => x.e)).toEqual(testBundle.taps.slice(0, 7));
  });

  it("skips to the end delivering all remaining events", () => {
    const clock = createManualClock();
    const feed = createReplayFeed(testBundle, { clock });
    const got = record(feed, clock);
    feed.start();
    clock.advance(7500);
    feed.skipToEnd();
    expect(got.taps.map((x) => x.e)).toEqual(testBundle.taps);
    expect(got.positions).toEqual(testBundle.positions);
    expect(feed.status()).toBe("ended");
    clock.advance(60_000);
    expect(got.taps).toHaveLength(testBundle.taps.length);
  });

  it("can skip to the end before starting", () => {
    const feed = createReplayFeed(testBundle, { clock: createManualClock() });
    feed.skipToEnd();
    expect(feed.delivered().taps).toEqual(testBundle.taps);
  });

  it("adds an end when the log has none, and stop() ends early with one end", () => {
    const clock = createManualClock();
    const noEnd = createReplayFeed({ taps: testBundle.taps.slice(0, 3), positions: [] }, { clock });
    noEnd.skipToEnd();
    expect(noEnd.delivered().taps.at(-1)).toEqual({ type: "end", t: 5 });

    const feed = createReplayFeed(testBundle, { clock });
    feed.start();
    clock.advance(6000);
    feed.stop();
    const taps = feed.delivered().taps;
    expect(taps.at(-1)).toEqual({ type: "end", t: 6 });
    expect(taps.filter((e) => e.type === "end")).toHaveLength(1);
    expect(feed.status()).toBe("ended");
    feed.stop();
    expect(feed.delivered().taps).toHaveLength(taps.length);
  });

  it("start twice does nothing", () => {
    const clock = createManualClock();
    const feed = createReplayFeed(testBundle, { clock });
    feed.start();
    feed.start();
    expect(feed.delivered().taps).toHaveLength(1);
  });
});
