import { describe, expect, it } from "vitest";
import { defaultView, keyAction, keyHints, navigate, stepIndex, stepOf, viewAt, STEPS, VIEW_ORDER } from "./steps";
import { parseParams } from "./params";

describe("steps and views", () => {
  it("navigates through views and clamps at both ends", () => {
    expect(VIEW_ORDER).toEqual(["play", "orders", "compare", "run"]);
    for (let i = 0; i < VIEW_ORDER.length; i++) {
      expect(navigate(VIEW_ORDER[i]!, { type: "next" })).toBe(viewAt(i + 1));
      expect(navigate(VIEW_ORDER[i]!, { type: "back" })).toBe(viewAt(i - 1));
    }
    expect(viewAt(-3)).toBe("play");
    expect(viewAt(99)).toBe("run");
  });
  it("maps keys to step jumps and view navigation", () => {
    expect(keyAction("Delete")).toEqual({ type: "delete" });
    expect(keyAction("ArrowRight")).toEqual({ type: "next" });
    expect(keyAction(" ")).toEqual({ type: "next" });
    expect(keyAction("PageDown")).toEqual({ type: "next" });
    expect(keyAction("ArrowLeft")).toEqual({ type: "back" });
    expect(keyAction("PageUp")).toEqual({ type: "back" });
    expect(keyAction("1")).toEqual({ type: "jump", step: "build" });
    expect(keyAction("2")).toEqual({ type: "jump", step: "orders" });
    expect(keyAction("3")).toEqual({ type: "jump", step: "results" });
    expect(keyAction("4")).toBeNull();
    expect(keyAction("0")).toBeNull();
    expect(keyAction("a")).toEqual({ type: "suggest" });
    expect(keyAction("A")).toEqual({ type: "suggest" });
    expect(keyAction("c")).toEqual({ type: "costs" });
    expect(navigate("test", { type: "jump", step: "results" })).toBe("compare");
    expect(navigate("scan", { type: "jump", step: "build" })).toBe("play");
    expect(stepOf("run")).toBe("results");
    expect(stepIndex("build")).toBe(0);
    expect(defaultView("build")).toBe("play");
    expect(keyHints("run", true).some((h) => h.does.includes("scenarios"))).toBe(true);
    expect(STEPS[2].views).toEqual(["compare", "run"]);
    expect(keyHints("compare", false).some((h) => h.does.includes("scenarios"))).toBe(true);
  });
  it("has no inputs key: i does nothing, no hint mentions I, step 3 is Run", () => {
    expect(keyAction("i")).toBeNull();
    expect(keyAction("I")).toBeNull();
    for (const view of VIEW_ORDER) {
      expect(keyHints(view, true).some((h) => h.keys === "I")).toBe(false);
      expect(keyHints(view, false).some((h) => h.keys === "I")).toBe(false);
    }
    expect(STEPS[2].name).toBe("Run");
  });
});

describe("params", () => {
  it("defaults to the recorded counter-a run", () => {
    expect(parseParams("")).toEqual({ runId: "counter-a", mode: "replay", speed: 1, view: "play" });
  });
  it("reads steps and result views, ignoring invalid values", () => {
    expect(parseParams("?run=counter-b&mode=live&speed=8&step=1&view=test")).toEqual({ runId: "counter-b", mode: "live", speed: 8, view: "play" });
    expect(parseParams("?step=2").view).toBe("orders");
    expect(parseParams("?step=3").view).toBe("compare");
    expect(parseParams("?step=3&view=run").view).toBe("run");
    expect(parseParams("?step=3&view=test").view).toBe("run");
    expect(parseParams("?step=3&view=play").view).toBe("compare");
    expect(parseParams("?step=6").view).toBe("compare");
    expect(parseParams("?step=2.5").view).toBe("play");
    expect(parseParams("?step=-2").view).toBe("play");
  });
});
