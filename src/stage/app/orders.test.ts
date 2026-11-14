import { describe, expect, it } from "vitest";
import { clampOrders, releasesFor } from "./orders";

const schedule = [
  { orderId: "one", itemId: "coffee", t: 1 },
  { orderId: "sim-4", itemId: "tea", t: 3 },
  { orderId: "three", itemId: "coffee", t: 6 },
];

describe("simulation orders", () => {
  it("truncates the recorded schedule", () => {
    expect(releasesFor(schedule, 2)).toEqual(schedule.slice(0, 2));
  });
  it("extends with cycling gaps and items and unique ids", () => {
    const result = releasesFor(schedule, 8);
    expect(result.map((o) => o.t)).toEqual([1, 3, 6, 8, 11, 13, 16, 18]);
    expect(result.every((o) => schedule.some((s) => s.itemId === o.itemId))).toBe(true);
    expect(new Set(result.map((o) => o.orderId)).size).toBe(result.length);
    expect(result.slice(0, 3)).toEqual(schedule);
    expect(releasesFor([{ orderId: "o", itemId: "x", t: 0 }], 3).map((o) => o.t)).toEqual([0, 1, 2]);
    expect(releasesFor([], 3)).toEqual([]);
  });
  it("clamps the requested count", () => {
    expect(clampOrders(-10)).toBe(1);
    expect(clampOrders(100)).toBe(30);
    expect(clampOrders(5.9)).toBe(5);
    expect(clampOrders(NaN)).toBe(1);
  });
});
