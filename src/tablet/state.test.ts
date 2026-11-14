import { describe, expect, it } from "vitest";
import type { RunStateMessage } from "../inputs/protocol";
import { testLayout, testSetup } from "../inputs/test-data";
import { boardView, initialTabletState, tabletReducer, tapFor, type TabletAction, type TabletState } from "./state";

const runState = (over: Partial<RunStateMessage> = {}): TabletAction => ({
  type: "run-state",
  message: { type: "run-state", runId: "r1", status: "running", t: 0, setup: testSetup, workers: testLayout.workers, events: [], ...over },
});
const apply = (actions: readonly TabletAction[], from: TabletState = initialTabletState) => actions.reduce(tabletReducer, from);
const order = (orderId: string, t = 0): TabletAction => ({ type: "stage-tap", message: { type: "order", t, orderId, itemId: "latte" } });

describe("tablet state", () => {
  it("has no board before the stage says anything", () => {
    expect(boardView(initialTabletState)).toBeUndefined();
  });

  it("shows released orders at the first station, first come first served", () => {
    const s = apply([runState(), order("o2"), order("o1")]);
    const board = boardView(s);
    expect(board?.stations.map((st) => st.name)).toEqual(["Order", "Make"]);
    expect(board?.stations[0]?.tickets.map((t) => t.label)).toEqual(["#2", "#1"]);
    expect(board?.stations[0]?.workers.map((w) => w.id)).toEqual(["red"]);
    expect(board?.total).toBe(3);
  });

  it("moves a ticket on at once when tapped, and keeps it there when the stage confirms", () => {
    let s = apply([runState(), order("o1")]);
    const ticket = boardView(s)?.stations[0]?.tickets[0];
    if (ticket === undefined) throw new Error("no ticket");
    s = tabletReducer(s, { type: "local-tap", tap: tapFor(ticket, "t1") });
    s = tabletReducer(s, { type: "local-tap", tap: tapFor(ticket, "t1") });
    expect(s.pending).toHaveLength(1);
    expect(boardView(s)?.stations[1]?.tickets.map((t) => t.orderId)).toEqual(["o1"]);
    s = tabletReducer(s, { type: "stage-tap", message: { type: "done", t: 3, orderId: "o1", step: 0, stationId: "b-till", tapId: "t1" } });
    expect(s.pending).toEqual([]);
    expect(s.events.at(-1)).toEqual({ type: "done", t: 3, orderId: "o1", step: 0, stationId: "b-till" });
    expect(boardView(s)?.stations[1]?.tickets.map((t) => t.orderId)).toEqual(["o1"]);
  });

  it("puts a rejected tap back and says why", () => {
    let s = apply([runState(), order("o1")]);
    s = tabletReducer(s, { type: "local-tap", tap: { type: "tap", tapId: "x", orderId: "o1", step: 0, stationId: "b-till" } });
    s = tabletReducer(s, { type: "stage-tap", message: { type: "tap-rejected", tapId: "x", reason: "the run is not running" } });
    expect(s.notice).toBe("Not counted: the run is not running");
    expect(boardView(s)?.stations[0]?.tickets).toHaveLength(1);
    expect(tabletReducer(s, { type: "clear-notice" }).notice).toBeUndefined();
    expect(tabletReducer(s, { type: "stage-tap", message: { type: "tap-rejected", tapId: "other", reason: "r" } })).toBe(s);
  });

  it("counts completed orders and ignores duplicate events", () => {
    const s = apply([
      runState(),
      order("o1"),
      order("o1"),
      { type: "stage-tap", message: { type: "done", t: 1, orderId: "o1", step: 0, stationId: "b-till" } },
      { type: "stage-tap", message: { type: "done", t: 1, orderId: "o1", step: 0, stationId: "b-till" } },
      { type: "stage-tap", message: { type: "done", t: 2, orderId: "o1", step: 1, stationId: "b-make" } },
      { type: "stage-tap", message: { type: "end", t: 3 } },
      { type: "stage-tap", message: { type: "end", t: 3 } },
    ]);
    expect(s.events).toHaveLength(4);
    expect(boardView(s)?.completed).toBe(1);
    expect(s.run?.status).toBe("ended");
  });

  it("rebuilds from a run-state after reconnecting, keeping unconfirmed taps of the same run", () => {
    let s = apply([runState(), order("o1")]);
    s = tabletReducer(s, { type: "local-tap", tap: { type: "tap", tapId: "a", orderId: "o1", step: 0, stationId: "b-till" } });
    s = tabletReducer(s, { type: "connection", state: "closed" });
    expect(s.connection).toBe("closed");
    s = tabletReducer(s, runState({ events: [{ type: "order", t: 0, orderId: "o1", itemId: "latte" }] }));
    expect(s.pending).toHaveLength(1);
    s = tabletReducer(s, runState({ runId: "r2", events: [] }));
    expect(s.pending).toEqual([]);
    expect(s.events).toEqual([]);
  });
});
