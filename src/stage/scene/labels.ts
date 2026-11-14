/**
 * HTML overlay labels: crisp at any projector resolution. Item name tags,
 * pile count badges, path distance tags and the short "Fixed: power" hint.
 * Positions are written with transforms each rendered frame; sizes are read
 * from the DOM only when text changes.
 */
import { fonts, palette, roleColors, type RoleKey } from "../theme/tokens";

const STYLE_ID = "dr-scene-labels-style";
const LOCK_SVG =
  '<svg viewBox="0 0 16 18" width="0.8em" height="0.9em" aria-hidden="true"><rect x="1.5" y="7.5" width="13" height="9.5" rx="2.5" fill="currentColor"/><path d="M4.5 8V5.5a3.5 3.5 0 0 1 7 0V8" fill="none" stroke="currentColor" stroke-width="2.4"/></svg>';
const MOVE_SVG =
  '<svg viewBox="0 0 20 20" width="0.85em" height="0.85em" aria-hidden="true"><path d="M10 1l3 3h-2v5h5V7l3 3-3 3v-2h-5v5h2l-3 3-3-3h2v-5H4v2l-3-3 3-3v2h5V4H7z" fill="currentColor"/></svg>';

function injectStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
.dr-overlay{position:absolute;inset:0;pointer-events:none;overflow:hidden;font-family:${fonts.display};}
.dr-tag{position:absolute;left:0;top:0;white-space:nowrap;will-change:transform;display:flex;align-items:center;gap:.35em;
  padding:.08em .62em .02em .5em;border-radius:999px;background:${palette.paper};color:${palette.ink};font-weight:750;line-height:1.25;
  border:.12em solid ${palette.ink};box-shadow:0 .16em 0 rgba(59,47,40,.22);transition:opacity .3s ease, background-color .5s ease, border-color .5s ease;}
.dr-tag .dot{width:.62em;height:.62em;border-radius:50%;flex:none;box-shadow:inset 0 0 0 .1em rgba(59,47,40,.35);transition:background-color .5s ease;}
.dr-tag .txt{display:grid;}
.dr-tag .txt>span{grid-area:1/1;transition:opacity .45s ease;}
.dr-tag .scan{font-family:${fonts.body};font-weight:700;font-style:italic;color:${palette.scan};opacity:0;}
.dr-tag.mode-scan{border-color:${palette.scan};border-style:dashed;background:rgba(255,250,240,.92);}
.dr-tag.mode-scan .scan{opacity:1}.dr-tag.mode-scan .name{opacity:0}
.dr-tag.mode-scan .dot{background:transparent!important;box-shadow:inset 0 0 0 .12em ${palette.scan};}
.dr-tag .ico{display:none;color:${palette.bolt};}
.dr-tag.locked .ico.lock{display:inline-flex}
.dr-tag.movable .ico.move{display:inline-flex;color:${palette.inkSoft}}
.dr-tag.mode-scan .ico{display:none!important}
.dr-tag.selected{background:${palette.select};}
.dr-tag.hidden{opacity:0}
.dr-tag.over-pawn{opacity:.3}
.dr-badge{position:absolute;left:0;top:0;will-change:transform;font-size:1.3em;min-width:1.55em;height:1.55em;border-radius:999px;display:flex;align-items:center;justify-content:center;
  font-weight:800;line-height:1;padding:0 .3em;box-sizing:border-box;background:${palette.ink};color:${palette.paper};border:.11em solid ${palette.paper};
  box-shadow:0 .14em 0 rgba(59,47,40,.3);transition:background-color .3s ease, opacity .25s ease;}
.dr-badge.alert{background:${palette.alert};}
.dr-badge.hidden{opacity:0}
.dr-badge.bump{animation:dr-bump .32s cubic-bezier(.34,1.56,.64,1);}
@keyframes dr-bump{0%{scale:1}40%{scale:1.3}100%{scale:1}}
.dr-path-tag{position:absolute;left:0;top:0;will-change:transform;padding:.05em .5em 0;border-radius:999px;background:${palette.path};color:${palette.paper};font-weight:800;white-space:nowrap;
  box-shadow:0 .12em 0 rgba(59,47,40,.25);}
.dr-hint{position:absolute;left:0;top:0;z-index:5;will-change:transform;display:flex;align-items:center;gap:.4em;padding:.25em .7em .2em;border-radius:14px;background:${palette.ink};color:${palette.paper};
  font-family:${fonts.body};font-weight:800;white-space:nowrap;opacity:0;transition:opacity .2s ease;}
.dr-hint.show{opacity:1}
@media (prefers-reduced-motion: reduce){.dr-badge.bump{animation:none}}
`;
  document.head.appendChild(s);
}

interface Placed {
  el: HTMLElement;
  w: number;
  h: number;
  measured: boolean;
}

function measure(p: Placed): void {
  if (p.measured) return;
  p.w = p.el.offsetWidth;
  p.h = p.el.offsetHeight;
  p.measured = true;
}

export class TagView {
  readonly placed: Placed;
  private readonly nameEl: HTMLSpanElement;
  private readonly scanEl: HTMLSpanElement;
  private readonly dot: HTMLSpanElement;
  private state = "";

  constructor(parent: HTMLElement) {
    const el = document.createElement("div");
    el.className = "dr-tag";
    el.innerHTML = `<span class="dot"></span><span class="ico lock">${LOCK_SVG}</span><span class="ico move">${MOVE_SVG}</span><span class="txt"><span class="name"></span><span class="scan"></span></span>`;
    this.dot = el.querySelector(".dot") as HTMLSpanElement;
    this.nameEl = el.querySelector(".name") as HTMLSpanElement;
    this.scanEl = el.querySelector(".scan") as HTMLSpanElement;
    parent.appendChild(el);
    this.placed = { el, w: 0, h: 0, measured: false };
  }

  set(o: { name: string; category: string; role: RoleKey; locked: boolean; movable: boolean; scanMode: boolean; selected: boolean; hidden: boolean }): void {
    const state = JSON.stringify(o);
    if (state === this.state) return;
    const textChanged = !this.state || JSON.parse(this.state).name !== o.name || JSON.parse(this.state).category !== o.category;
    this.state = state;
    this.nameEl.textContent = o.name;
    this.scanEl.textContent = o.category;
    this.dot.style.backgroundColor = roleColors[o.role].body;
    const c = this.placed.el.classList;
    c.toggle("mode-scan", o.scanMode);
    c.toggle("locked", o.locked);
    c.toggle("movable", o.movable);
    c.toggle("selected", o.selected);
    c.toggle("hidden", o.hidden);
    if (textChanged) this.placed.measured = false;
  }

  remove(): void {
    this.placed.el.remove();
  }
}

export class BadgeView {
  readonly placed: Placed;
  private count = -1;

  constructor(parent: HTMLElement) {
    const el = document.createElement("div");
    el.className = "dr-badge hidden";
    parent.appendChild(el);
    this.placed = { el, w: 0, h: 0, measured: false };
  }

  set(count: number, alert: boolean): void {
    const c = this.placed.el.classList;
    c.toggle("alert", alert);
    if (count === this.count) return;
    const grew = count > this.count && this.count >= 0;
    this.count = count;
    this.placed.el.textContent = String(count);
    c.toggle("hidden", count <= 0);
    this.placed.measured = false;
    if (grew) {
      c.remove("bump");
      void this.placed.el.offsetWidth;
      c.add("bump");
    }
  }

  remove(): void {
    this.placed.el.remove();
  }
}

export class Overlay {
  readonly el = document.createElement("div");
  private readonly hint = document.createElement("div");
  private hintUntil = 0;
  private fontPx = 24;
  private pathTags: Placed[] = [];
  private width = 1;
  private height = 1;

  constructor(container: HTMLElement) {
    injectStyle();
    this.el.className = "dr-overlay";
    this.hint.className = "dr-hint";
    this.el.appendChild(this.hint);
    container.appendChild(this.el);
  }

  /** Label size follows the scene size so two half-width scenes stay balanced. */
  /** Returns true when the size changed (callers then re-measure their tags). */
  resize(w: number, h: number): boolean {
    this.width = w;
    this.height = h;
    const px = Math.round(Math.min(30, Math.max(18, Math.min(h * 0.027, w * 0.0205))));
    if (px === this.fontPx && this.el.style.fontSize) return false;
    this.fontPx = px;
    this.el.style.fontSize = `${px}px`;
    for (const p of this.pathTags) p.measured = false;
    return true;
  }

  get fontSize(): number {
    return this.fontPx;
  }

  invalidateSizes(placed: readonly Placed[]): void {
    for (const p of placed) p.measured = false;
  }

  /**
   * Place name tags centred above their anchor, front to back, never on top of
   * an earlier tag, a badge or a keep-out area (e.g. a "Before" label), and
   * always inside the scene (never up under the step strip or off the side).
   * Order of tries: nudged up; shifted sideways; below the anchor; and only if
   * all fail, clamped inside the scene even if it overlaps.
   */
  layoutTags(
    items: readonly { placed: Placed; x: number; y: number; depth: number; visible: boolean }[],
    blockers: readonly { l: number; r: number; t: number; b: number }[] = [],
    see: readonly { x: number; y: number }[] = [],
  ): void {
    const sorted = [...items].sort((a, b) => b.depth - a.depth);
    const boxes: { l: number; r: number; t: number; b: number }[] = [...blockers];
    const pad = 4;
    for (const it of sorted) {
      const p = it.placed;
      if (!it.visible) {
        p.el.style.display = "none";
        continue;
      }
      p.el.style.display = "";
      measure(p);
      const { l, t } = this.findSpot(p, it.x, it.y, boxes, pad);
      boxes.push({ l, r: l + p.w, t, b: t + p.h });
      // Fade a tag that sits over a worker's head so the hat stays visible.
      const covers = see.some((q) => q.x > l && q.x < l + p.w && q.y > t - 6 && q.y < t + p.h + 6);
      p.el.classList.toggle("over-pawn", covers);
      p.el.style.transform = `translate(${Math.round(l)}px, ${Math.round(t)}px)`;
    }
  }

  private findSpot(p: Placed, x: number, y: number, boxes: readonly { l: number; r: number; t: number; b: number }[], pad: number): { l: number; t: number } {
    const maxL = Math.max(pad, this.width - p.w - pad);
    const clampL = (l: number) => Math.min(maxL, Math.max(pad, l));
    const hitAt = (l: number, t: number) => boxes.find((bx) => l < bx.r + 4 && l + p.w > bx.l - 4 && t < bx.b + 3 && t + p.h > bx.t - 3);
    const inside = (t: number) => t >= pad && t + p.h <= this.height - pad;
    const upFrom = (l: number, t0: number): number | null => {
      let t = t0;
      for (let pass = 0; pass < 6; pass++) {
        const hit = hitAt(l, t);
        if (!hit) return inside(t) ? t : null;
        t = hit.t - p.h - 4;
      }
      return null;
    };
    const l0 = clampL(x - p.w / 2);
    const t0 = Math.min(y - p.h, this.height - pad - p.h);
    const up = upFrom(l0, t0);
    if (up !== null) return { l: l0, t: up };
    for (const dx of [p.w / 2 + 6, -(p.w / 2 + 6), p.w + 8, -(p.w + 8)]) {
      const l = clampL(l0 + dx);
      const t = upFrom(l, Math.max(pad, t0));
      if (t !== null) return { l, t };
    }
    // Below the anchor point, stepping down past anything in the way.
    let t = Math.max(pad, y + 6);
    for (let pass = 0; pass < 6; pass++) {
      const hit = hitAt(l0, t);
      if (!hit) break;
      t = hit.b + 4;
    }
    if (inside(t) && !hitAt(l0, t)) return { l: l0, t };
    return { l: l0, t: Math.min(this.height - pad - p.h, Math.max(pad, t0)) };
  }

  /** Centre an element on (x, y); returns its screen rect, or null when hidden. */
  placeCentered(p: Placed, x: number, y: number, visible: boolean): { l: number; r: number; t: number; b: number } | null {
    if (!visible) {
      p.el.style.display = "none";
      return null;
    }
    p.el.style.display = "";
    measure(p);
    const l = Math.round(x - p.w / 2);
    const t = Math.round(y - p.h / 2);
    p.el.style.transform = `translate(${l}px, ${t}px)`;
    return { l, r: l + p.w, t, b: t + p.h };
  }

  setPathTags(labels: readonly string[]): readonly Placed[] {
    while (this.pathTags.length > labels.length) this.pathTags.pop()?.el.remove();
    while (this.pathTags.length < labels.length) {
      const el = document.createElement("div");
      el.className = "dr-path-tag";
      this.el.appendChild(el);
      this.pathTags.push({ el, w: 0, h: 0, measured: false });
    }
    labels.forEach((text, i) => {
      const p = this.pathTags[i];
      if (p && p.el.textContent !== text) {
        p.el.textContent = text;
        p.measured = false;
      }
    });
    return this.pathTags;
  }

  showHint(text: string, x: number, y: number, now: number): void {
    this.hint.innerHTML = `${LOCK_SVG}<span></span>`;
    (this.hint.lastChild as HTMLElement).textContent = text;
    this.hint.classList.add("show");
    const w = this.hint.offsetWidth;
    const h = this.hint.offsetHeight;
    this.hint.style.transform = `translate(${Math.round(x - w / 2)}px, ${Math.round(y - h - 8)}px)`;
    this.hintUntil = now + 1.6;
  }

  tick(now: number): boolean {
    if (this.hintUntil && now > this.hintUntil) {
      this.hint.classList.remove("show");
      this.hintUntil = 0;
    }
    return this.hintUntil > 0;
  }

  dispose(): void {
    this.el.remove();
  }
}
