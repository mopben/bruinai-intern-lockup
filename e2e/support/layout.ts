/**
 * Layout checks in the page: is an element fully on screen, not covered by
 * anything else, and is its text on one line?
 */
import type { Page } from "@playwright/test";

export interface Visibility {
  readonly testId: string;
  readonly ok: boolean;
  readonly why: string;
}

/**
 * True when the element is inside the viewport and every probe point (centre
 * and points just inside each corner) hits the element itself or something
 * inside it. Clipping by a scrolling parent counts as covered.
 */
export async function checkVisible(page: Page, selector: string, label = selector): Promise<Visibility> {
  return page.evaluate(
    ({ selector, label }) => {
      const el = document.querySelector(selector);
      if (!el) return { testId: label, ok: false, why: "missing" };
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return { testId: label, ok: false, why: "zero size" };
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      if (r.left < -0.5 || r.top < -0.5 || r.right > vw + 0.5 || r.bottom > vh + 0.5)
        return { testId: label, ok: false, why: `outside the viewport: ${Math.round(r.left)},${Math.round(r.top)} to ${Math.round(r.right)},${Math.round(r.bottom)} in ${vw}x${vh}` };
      // Probes a little inside the box: a neighbour's text may overhang a few pixels (font ascent) without hiding anything.
      const ix = Math.min(Math.max(4, r.width * 0.1), r.width / 4);
      const iy = Math.min(Math.max(4, r.height * 0.15), r.height / 4);
      const probes = [
        [r.left + r.width / 2, r.top + r.height / 2],
        [r.left + ix, r.top + iy],
        [r.right - ix, r.top + iy],
        [r.left + ix, r.bottom - iy],
        [r.right - ix, r.bottom - iy],
      ];
      for (const [x, y] of probes) {
        const hit = document.elementFromPoint(x as number, y as number);
        if (!hit || !(hit === el || el.contains(hit) || hit.contains(el))) {
          const hr = hit?.getBoundingClientRect();
          const who = hit ? `${hit.tagName.toLowerCase()}.${[...hit.classList].join(".")} (${Math.round(hr!.top)}-${Math.round(hr!.bottom)}; target ${Math.round(r.top)}-${Math.round(r.bottom)})` : "nothing";
          return { testId: label, ok: false, why: `covered at ${Math.round(x as number)},${Math.round(y as number)} by ${who}` };
        }
      }
      return { testId: label, ok: true, why: "" };
    },
    { selector, label },
  );
}

/** Number of text lines an element's text takes (1 = no wrapping). */
export async function lineCount(page: Page, selector: string): Promise<number> {
  return page.evaluate((selector) => {
    const el = document.querySelector(selector);
    if (!el) return 0;
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0).sort((a, b) => a.top - b.top);
    let lines = 0;
    let lineBottom = -Infinity;
    for (const r of rects) {
      // A rect starting below the middle of the current line starts a new line.
      if (r.top > lineBottom - 2) {
        lines += 1;
        lineBottom = r.bottom;
      } else lineBottom = Math.max(lineBottom, r.bottom);
    }
    return lines;
  }, selector);
}
