import { describe, expect, it } from "vitest";
import { keyAction, keyHints, navigate, stepAt } from "./steps";
import { parseParams } from "./params";

describe("steps", () => {
  it("moves forward and back and clamps at the ends", () => {
    expect(navigate("scan", { type: "next" })).toBe("run");
    expect(navigate("scan", { type: "back" })).toBe("scan");
    expect(navigate("compare", { type: "next" })).toBe("compare");
    expect(navigate("play", { type: "back" })).toBe("trust");
  });

  it("maps the operator's keys", () => {
    expect(keyAction("ArrowRight")).toEqual({ type: "next" });
    expect(keyAction(" ")).toEqual({ type: "next" });
    expect(keyAction("ArrowLeft")).toEqual({ type: "back" });
    expect(keyAction("4")).toEqual({ type: "jump", step: "play" });
    expect(keyAction("7")).toBeNull();
    expect(keyAction("0")).toBeNull();
    expect(keyAction("f")).toEqual({ type: "faster" });
    expect(keyAction("I")).toEqual({ type: "inputs" });
    expect(keyAction("x")).toBeNull();
  });

  it("jumps by number and clamps bad indices", () => {
    expect(navigate("scan", { type: "jump", step: "test" })).toBe("test");
    expect(stepAt(99)).toBe("compare");
    expect(stepAt(-3)).toBe("scan");
  });

  it("offers start in live runs and play again in recorded ones", () => {
    expect(keyHints("run", true).some((h) => h.does === "start")).toBe(true);
    expect(keyHints("run", false).some((h) => h.does === "play again")).toBe(true);
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

  it("rejects unsafe or silly values", () => {
    const p = parseParams("?run=../etc&mode=bogus&speed=-2&step=x");
    expect(p).toEqual({ runId: "counter-a", mode: "replay", speed: 1, step: "scan" });
  });
});
