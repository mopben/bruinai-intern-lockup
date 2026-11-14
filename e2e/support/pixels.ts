/**
 * Is a 3D view actually drawn? Takes a real screenshot of the element (what
 * the projector shows, not the WebGL buffer) and counts the pixels that are
 * not the empty table colour.
 */
import type { Locator, Page } from "@playwright/test";

/** The renderer's clear colour (palette.table, #cad7d0). */
const TABLE = [0xca, 0xd7, 0xd0] as const;

/** Share (0..1) of sampled pixels in the element's screenshot that differ from the table colour. */
export async function drawnShare(page: Page, target: Locator): Promise<number> {
  // A page screenshot clipped to the element: no actionability waits, which a busy software renderer can stall.
  await target.waitFor({ state: "visible", timeout: 10_000 });
  const box = await target.boundingBox();
  if (!box) return 0;
  const png = await page.screenshot({ clip: box, animations: "allow", timeout: 20_000 });
  return page.evaluate(
    async ({ b64, r, g, b }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext("2d");
      if (!ctx) return 0;
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, c.width, c.height).data;
      let drawn = 0;
      let total = 0;
      for (let i = 0; i < data.length; i += 4 * 7) {
        total += 1;
        const d = Math.abs(data[i]! - r) + Math.abs(data[i + 1]! - g) + Math.abs(data[i + 2]! - b);
        if (d > 24) drawn += 1;
      }
      return total === 0 ? 0 : drawn / total;
    },
    { b64: png.toString("base64"), r: TABLE[0], g: TABLE[1], b: TABLE[2] },
  );
}
