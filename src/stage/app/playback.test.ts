import { describe, expect, it } from "vitest";
import type { MovementSegment, RunTrace } from "../../core";
import { buildKitchen, coveringKitchen } from "../../core/engine/test-kitchens";
import { indexMovements, simulatedWorkers } from "./playback";

describe("playback of a walk segment", () => {
  it("draws a worker walking between stations as moving, not carrying", () => {
    const world = buildKitchen(coveringKitchen());
    const walk: MovementSegment = { workerId: "w", orderId: "o1", step: 1, kind: "walk", t0: 6, t1: 10, path: [{ x: 4, z: 0.85 }, { x: 0, z: 0.85 }] };
    const trace: RunTrace = { orders: [], queue: { stationIds: [], intervals: [], endT: 10 }, movements: [walk], endT: 10 };
    const moves = indexMovements(trace);
    expect(moves.get("w")).toEqual([walk]);
    const mid = simulatedWorkers(world, moves, 8)[0]!;
    expect(mid.x).toBeCloseTo(2, 9);
    expect(mid.z).toBeCloseTo(0.85, 9);
    expect(mid.carrying).toBe(false);
  });
});
