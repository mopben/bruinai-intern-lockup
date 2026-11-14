import { describe, expect, it } from "vitest";
import { components, detectColour, mergeFragments, type Blob } from "./blobs";
import { DEFAULT_THRESHOLDS, rgbToHsv } from "./color";
import { toHsvPlanes, downscale, type Frame } from "./frame";
import { chooseBlob } from "./select";

function canvas(w: number, h: number, bg: [number, number, number]): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i += 1) d.set([...bg, 255], i * 4);
  return d;
}
function disc(d: Uint8ClampedArray, w: number, cx: number, cy: number, r: number, rgb: [number, number, number]) {
  for (let y = Math.floor(cy - r); y <= cy + r; y += 1)
    for (let x = Math.floor(cx - r); x <= cx + r; x += 1)
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) d.set([...rgb, 255], (y * w + x) * 4);
}

const RED: [number, number, number] = [232, 49, 47];
const red = rgbToHsv(...RED);

describe("components", () => {
  it("labels separate regions with area and centroid", () => {
    const w = 10;
    const mask = new Uint8Array(100);
    for (const i of [11, 12, 21, 22]) mask[i] = 1; // 2x2 at (1..2, 1..2)
    mask[77] = 1;
    mask[88] = 1; // diagonal neighbour: same region
    const b = components(mask, w, 10).sort((a, c) => c.area - a.area);
    expect(b).toHaveLength(2);
    expect(b[0]).toMatchObject({ area: 4, cx: 2, cy: 2 });
    expect(b[1]!.area).toBe(2);
  });
});

describe("detectColour", () => {
  it("finds a red disc to within a pixel and ignores other colours and specks", () => {
    const w = 160;
    const h = 90;
    const d = canvas(w, h, [200, 190, 170]);
    disc(d, w, 40.5, 30.5, 6, RED);
    disc(d, w, 110.5, 60.5, 6, [31, 111, 224]);
    disc(d, w, 130.5, 20.5, 1, RED); // a speck: under min area
    const det = detectColour(toHsvPlanes({ width: w, height: h, data: d }), red, DEFAULT_THRESHOLDS, 20);
    expect(det.blobs).toHaveLength(1);
    expect(det.blobs[0]!.cx).toBeCloseTo(41, 0);
    expect(det.blobs[0]!.cy).toBeCloseTo(31, 0);
  });

  it("still finds the hat at 40% brightness (lighting change)", () => {
    const w = 80;
    const d = canvas(w, 60, [90, 85, 80]);
    disc(d, w, 30, 30, 7, [Math.round(232 * 0.4), Math.round(49 * 0.4), Math.round(47 * 0.4)]);
    const det = detectColour(toHsvPlanes({ width: w, height: 60, data: d }), red, DEFAULT_THRESHOLDS, 20);
    expect(det.blobs).toHaveLength(1);
  });

  it("merges a hat split in two by an occluding arm", () => {
    const w = 80;
    const d = canvas(w, 60, [200, 190, 170]);
    disc(d, w, 30, 30, 7, RED);
    for (let y = 0; y < 60; y += 1) for (let x = 29; x <= 31; x += 1) d.set([60, 50, 40, 255], (y * w + x) * 4);
    const det = detectColour(toHsvPlanes({ width: w, height: 60, data: d }), red, DEFAULT_THRESHOLDS, 20);
    expect(det.blobs).toHaveLength(1);
    expect(det.blobs[0]!.cx).toBeCloseTo(30.5, 0);
  });

  it("works after a box downscale", () => {
    const w = 320;
    const d = canvas(w, 180, [200, 190, 170]);
    disc(d, w, 200, 100, 14, RED);
    const small = downscale({ width: w, height: 180, data: d } as Frame, 160);
    expect(small.width).toBe(160);
    expect(small.height).toBe(90);
    const det = detectColour(toHsvPlanes(small), red, DEFAULT_THRESHOLDS, 20);
    expect(det.blobs[0]!.cx).toBeCloseTo(100.25, 0);
  });
});

const blob = (cx: number, cy: number, area: number): Blob => ({ area, cx, cy, minX: cx, minY: cy, maxX: cx, maxY: cy });

describe("mergeFragments", () => {
  it("keeps far blobs apart", () => {
    expect(mergeFragments([blob(10, 10, 50), blob(100, 10, 50)])).toHaveLength(2);
  });
  it("joins near ones with an area-weighted centre", () => {
    const m = mergeFragments([blob(10, 10, 30), blob(16, 10, 10)]);
    expect(m).toHaveLength(1);
    expect(m[0]!.cx).toBeCloseTo(11.5);
  });
});

describe("chooseBlob", () => {
  it("takes the only blob, or the clearly larger one", () => {
    expect(chooseBlob([blob(5, 5, 100)], 320, undefined).kind).toBe("found");
    expect(chooseBlob([blob(5, 5, 100), blob(200, 5, 20)], 320, undefined)).toMatchObject({ kind: "found", blob: { cx: 5 } });
  });
  it("is ambiguous with two similar blobs and no history", () => {
    expect(chooseBlob([blob(5, 5, 100), blob(200, 5, 90)], 320, undefined).kind).toBe("ambiguous");
  });
  it("uses the previous position to settle it, if one candidate is near", () => {
    const pick = chooseBlob([blob(5, 5, 100), blob(200, 5, 90)], 320, { x: 196, y: 8 });
    expect(pick).toMatchObject({ kind: "found", blob: { cx: 200 } });
    expect(chooseBlob([blob(5, 5, 100), blob(200, 5, 90)], 320, { x: 100, y: 100 }).kind).toBe("ambiguous");
  });
  it("reports none for no blobs", () => {
    expect(chooseBlob([], 320, undefined).kind).toBe("none");
  });
});
