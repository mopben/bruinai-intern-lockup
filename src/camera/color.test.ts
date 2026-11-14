import { describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS, hexToRgb, hsvToRgb, hueDistance, matches, rgbToHsv, targetFromHex, targetFromSamples } from "./color";

describe("colour conversion", () => {
  it("converts primaries and greys", () => {
    expect(rgbToHsv(255, 0, 0)).toEqual({ h: 0, s: 1, v: 1 });
    expect(rgbToHsv(0, 255, 0).h).toBeCloseTo(120);
    expect(rgbToHsv(0, 0, 255).h).toBeCloseTo(240);
    expect(rgbToHsv(255, 0, 255).h).toBeCloseTo(300);
    expect(rgbToHsv(128, 128, 128)).toEqual({ h: 0, s: 0, v: 128 / 255 });
    expect(rgbToHsv(0, 0, 0)).toEqual({ h: 0, s: 0, v: 0 });
  });

  it("converts the four hat colours to the expected hues", () => {
    const hue = (hex: string) => {
      const t = targetFromHex(hex);
      if (!t.ok) throw new Error(t.error);
      return t.value.h;
    };
    expect(hue("#e8312f")).toBeCloseTo(0.7, 0);
    expect(hue("#1f6fe0")).toBeCloseTo(215, 0);
    expect(hue("#f5c400")).toBeCloseTo(48, 0);
    expect(hue("#1fa84f")).toBeCloseTo(141, 0);
  });

  it("round-trips hsv to rgb", () => {
    for (const [r, g, b] of [[232, 49, 47], [31, 111, 224], [245, 196, 0], [31, 168, 79], [10, 200, 90]] as const) {
      expect(hsvToRgb(rgbToHsv(r, g, b))).toEqual({ r, g, b });
    }
  });

  it("parses hex and rejects junk", () => {
    expect(hexToRgb("#E8312F")).toEqual({ r: 232, g: 49, b: 47 });
    expect(hexToRgb("red")).toBeUndefined();
    expect(targetFromHex("#12").ok).toBe(false);
  });

  it("measures hue distance round the circle", () => {
    expect(hueDistance(355, 5)).toBe(10);
    expect(hueDistance(5, 355)).toBe(10);
    expect(hueDistance(0, 180)).toBe(180);
  });
});

describe("matching", () => {
  const red = { h: 1, s: 0.8, v: 0.9 };
  it("accepts the hat in shade, rejects skin, wood and grey", () => {
    const shade = rgbToHsv(150, 35, 35);
    expect(matches(red, DEFAULT_THRESHOLDS, shade.h, shade.s, shade.v)).toBe(true);
    const skin = rgbToHsv(224, 172, 140);
    expect(matches(red, DEFAULT_THRESHOLDS, skin.h, skin.s, skin.v)).toBe(false);
    const wood = rgbToHsv(170, 130, 90);
    expect(matches(red, DEFAULT_THRESHOLDS, wood.h, wood.s, wood.v)).toBe(false);
    expect(matches(red, DEFAULT_THRESHOLDS, 0, 0.05, 0.6)).toBe(false);
  });
  it("tells yellow from the red and green neighbours", () => {
    const yellow = { h: 48, s: 1, v: 0.96 };
    for (const [r, g, b] of [[232, 49, 47], [31, 168, 79], [230, 120, 30]] as const) {
      const c = rgbToHsv(r, g, b);
      expect(matches(yellow, DEFAULT_THRESHOLDS, c.h, c.s, c.v)).toBe(false);
    }
  });
});

describe("targetFromSamples", () => {
  it("averages hue round the circle and ignores grey background", () => {
    const pixels = [
      ...Array.from({ length: 20 }, (_, i) => ({ h: i % 2 ? 358 : 4, s: 0.7, v: 0.6 })),
      ...Array.from({ length: 5 }, () => ({ h: 30, s: 0.02, v: 0.8 })),
    ];
    const t = targetFromSamples(pixels);
    expect(t.ok).toBe(true);
    if (t.ok) {
      expect(hueDistance(t.value.h, 1)).toBeLessThan(0.5);
      expect(t.value.s).toBeCloseTo(0.7);
      expect(t.value.source).toBe("sampled");
    }
  });
  it("refuses a grey spot and a two-colour spot", () => {
    expect(targetFromSamples(Array.from({ length: 25 }, () => ({ h: 0, s: 0.05, v: 0.5 }))).ok).toBe(false);
    const mixed = [...Array.from({ length: 12 }, () => ({ h: 0, s: 0.8, v: 0.8 })), ...Array.from({ length: 12 }, () => ({ h: 215, s: 0.8, v: 0.8 }))];
    expect(targetFromSamples(mixed).ok).toBe(false);
  });
});
