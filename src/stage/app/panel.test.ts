import { describe, expect, it } from "vitest";
import { PANEL_MIN, PANEL_SNAP, clampWidth, defaultPanelWidth, dragResult, panelMax, parsePanel } from "./panel";

const VW = 1440;

describe("panel width", () => {
  it("clamps to the minimum and to 60vw", () => {
    expect(clampWidth(50, VW)).toBe(PANEL_MIN);
    expect(clampWidth(2000, VW)).toBe(panelMax(VW));
    expect(clampWidth(400, VW)).toBe(400);
  });
  it("snaps closed below 180 and keeps the width it had before the drag", () => {
    const r = dragResult(PANEL_SNAP - 1, 400, VW);
    expect(r.open).toBe(false);
    expect(r.width).toBe(400);
  });
  it("stays open at or above the snap, clamped", () => {
    expect(dragResult(PANEL_SNAP, 400, VW)).toEqual({ open: true, width: PANEL_MIN });
    expect(dragResult(5000, 400, VW)).toEqual({ open: true, width: panelMax(VW) });
  });
});

describe("parsePanel", () => {
  it("falls back to the default on missing or broken json", () => {
    const def = { open: true, width: defaultPanelWidth(VW) };
    expect(parsePanel(null, VW)).toEqual(def);
    expect(parsePanel("not json", VW)).toEqual(def);
    expect(parsePanel("42", VW)).toEqual(def);
    expect(parsePanel("{}", VW)).toEqual(def);
  });
  it("reads a saved state and clamps an out-of-range width", () => {
    expect(parsePanel('{"open":false,"width":420}', VW)).toEqual({ open: false, width: 420 });
    expect(parsePanel('{"open":true,"width":99999}', VW)).toEqual({ open: true, width: panelMax(VW) });
    expect(parsePanel('{"open":"yes","width":"big"}', VW)).toEqual({ open: true, width: defaultPanelWidth(VW) });
  });
});
