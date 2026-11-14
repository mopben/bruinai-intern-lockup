import { describe, expect, it } from "vitest";
import { STEP_IDS, keyAction, keyHints, navigate, stepAt } from "./steps";
import { parseParams } from "./params";

describe("steps", () => {
  it("has five steps, ending in Test", () => {
    expect(STEP_IDS).toEqual(["scan", "run", "trust", "play", "test"]);
  });

  it("moves forward and back and clamps at the ends", () => {
    expect(navigate("scan", { type: "next" })).toBe("run");
    expect(navigate("scan", { type: "back" })).toBe("scan");
    expect(navigate("test", { type: "next" })).toBe("test");
    expect(navigate("play", { type: "back" })).toBe("trust");
  });

  it("maps the operator's keys", () => {
    expect(keyAction("ArrowRight")).toEqual({ type: "next" });
    expect(keyAction(" ")).toEqual({ type: "next" });
    expect(keyAction("ArrowLeft")).toEqual({ type: "back" });
    expect(keyAction("4")).toEqual({ type: "jump", step: "play" });
    expect(keyAction("5")).toEqual({ type: "jump", step: "test" });
    expect(keyAction("6")).toBeNull();
    expect(keyAction("7")).toBeNull();
    expect(keyAction("c")).toEqual({ type: "check" });
    expect(keyAction("C")).toEqual({ type: "check" });
    expect(keyAction("0")).toBeNull();
    expect(keyAction("f")).toEqual({ type: "faster" });
    expect(keyAction("I")).toEqual({ type: "inputs" });
    expect(keyAction("x")).toBeNull();
  });

  it("jumps by number and clamps bad indices", () => {
    expect(navigate("scan", { type: "jump", step: "test" })).toBe("test");
    expect(stepAt(99)).toBe("test");
    expect(stepAt(-3)).toBe("scan");
  });

  it("offers start in live runs and play again in recorded ones", () => {
    expect(keyHints("run", true).some((h) => h.does === "start")).toBe(true);
    expect(keyHints("run", false).some((h) => h.does === "play again")).toBe(true);
  });

  it("offers the real-run check in the simulated Test, and the way back inside the check", () => {
    expect(keyHints("test", false)).toEqual([
      { keys: "←", does: "back" },
      { keys: "P", does: "play again" },
      { keys: "F", does: "faster" },
      { keys: "C", does: "check with a real run" },
      { keys: "I", does: "inputs" },
    ]);
    const inCheck = keyHints("test", true, true);
    expect(inCheck.some((h) => h.does === "start")).toBe(true);
    expect(inCheck.some((h) => h.keys === "C" && h.does === "back to the simulation")).toBe(true);
  });
});

describe("params", () => {
  it("defaults to the recorded counter-a run", () => {
    expect(parseParams("")).toEqual({ runId: "counter-a", mode: "replay", speed: 1, step: "scan" });
  });

  it("reads run, mode, speed and step", () => {
    expect(parseParams("?run=counter-b-fridge-closer&mode=live&speed=8&step=4")).toEqual({
      runId: "counter-b-fridge-closer",
      mode: "live",
      speed: 8,
      step: "play",
    });
  });

  it("opens Test for step 6, the old Compare step", () => {
    expect(parseParams("?step=5").step).toBe("test");
    expect(parseParams("?step=6").step).toBe("test");
  });

  it("rejects unsafe or silly values", () => {
    const p = parseParams("?run=../etc&mode=bogus&speed=-2&step=x");
    expect(p).toEqual({ runId: "counter-a", mode: "replay", speed: 1, step: "scan" });
  });
});
