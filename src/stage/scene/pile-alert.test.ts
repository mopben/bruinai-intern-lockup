import { describe, expect, it } from "vitest";
import { NO_ALERT, OFF_HOLD_S, ON_HOLD_S, nextAlert, type AlertState } from "./pile-alert";

function run(frames: readonly [number, Record<string, number>][]): (string | null)[] {
  let s: AlertState = NO_ALERT;
  return frames.map(([t, q]) => (s = nextAlert(s, q, t)).on);
}

describe("the bottleneck glow", () => {
  it("never glows when queues are balanced, however tall", () => {
    const frames = Array.from({ length: 50 }, (_, i) => [i * 0.1, { a: 4, b: 4, c: 3 }] as [number, Record<string, number>]);
    expect(run(frames).every((x) => x === null)).toBe(true);
  });
  it("needs a clear lead of two and a short hold before it glows", () => {
    expect(run([[0, { a: 2, b: 1 }], [1, { a: 2, b: 1 }], [2, { a: 2, b: 1 }]])).toEqual([null, null, null]);
    expect(run([[0, { a: 3, b: 1 }], [ON_HOLD_S / 2, { a: 3, b: 1 }], [ON_HOLD_S + 0.01, { a: 3, b: 1 }]])).toEqual([null, null, "a"]);
  });
  it("holds through a short dip, then lets go", () => {
    const on = [[0, { a: 3, b: 0 }], [1, { a: 3, b: 0 }]] as [number, Record<string, number>][];
    // Lead of one still holds.
    expect(run([...on, [1.5, { a: 2, b: 1 }], [5, { a: 2, b: 1 }]]).slice(-2)).toEqual(["a", "a"]);
    // A tie is a dip: kept for OFF_HOLD_S, then off.
    expect(run([...on, [1.5, { a: 2, b: 2 }], [1.5 + OFF_HOLD_S / 2, { a: 2, b: 2 }], [1.6 + OFF_HOLD_S, { a: 2, b: 2 }]]).slice(-3)).toEqual(["a", "a", null]);
    // Empty: off at once.
    expect(run([...on, [1.5, { a: 0, b: 0 }]]).at(-1)).toBeNull();
  });
});
