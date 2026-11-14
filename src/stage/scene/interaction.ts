/**
 * Pointer handling for one scene: pick, drag, select, rotate, orbit, pan, zoom.
 * Mouse, pen and touch all arrive as pointer events. The scene supplies the
 * geometry through `InteractionHost`; this file only decides what a gesture means.
 */

export interface InteractionHost {
  pickItem(clientX: number, clientY: number): string | null;
  floorPoint(clientX: number, clientY: number): { x: number; z: number } | null;
  itemInfo(id: string): { x: number; z: number; locked: boolean } | null;
  isEditable(): boolean;
  cameraControls(): boolean;
  allowRotate(): boolean;
  selectedId(): string | null;
  beginDrag(id: string): void;
  dragTo(id: string, x: number, z: number): void;
  endDrag(id: string): void;
  nope(id: string): void;
  select(id: string | null): void;
  rotate(id: string): void;
  orbit(dx: number, dy: number): void;
  pan(dxPx: number, dyPx: number): void;
  zoom(factor: number, clientX: number, clientY: number): void;
  resetCamera(): void;
  setHover(id: string | null): void;
}

/** A press that moves less than this (CSS px) is a click. */
const CLICK_SLOP_PX = 7;
/** Zoom factor for the +/- keys. */
const KEY_ZOOM = 1.25;

type Gesture =
  | { kind: "none" }
  | { kind: "press"; id: string | null; x0: number; y0: number; pointerId: number }
  | { kind: "drag"; id: string; offX: number; offZ: number; pointerId: number }
  | { kind: "pan"; lastX: number; lastY: number; pointerId: number }
  | { kind: "orbit"; lastX: number; lastY: number; pointerId: number; moved: boolean }
  | { kind: "pinch"; a: number; b: number; dist: number; midX: number; midY: number };

export class Interaction {
  private g: Gesture = { kind: "none" };
  private hoverId: string | null = null;
  /** Live positions of every pointer currently down, for pinch. */
  private readonly pointers = new Map<number, { x: number; y: number }>();

  constructor(
    private readonly el: HTMLElement,
    private readonly host: InteractionHost,
  ) {
    el.style.touchAction = "none";
    el.addEventListener("pointerdown", this.onDown);
    el.addEventListener("pointermove", this.onMove);
    el.addEventListener("pointerup", this.onUp);
    el.addEventListener("pointercancel", this.onCancel);
    el.addEventListener("pointerleave", this.onLeave);
    el.addEventListener("dblclick", this.onDbl);
    el.addEventListener("wheel", this.onWheel, { passive: false });
    el.addEventListener("contextmenu", this.onContextMenu);
    window.addEventListener("keydown", this.onKey);
  }

  get dragging(): string | null {
    return this.g.kind === "drag" ? this.g.id : null;
  }

  private onDown = (e: PointerEvent): void => {
    const cc = this.host.cameraControls();
    if (e.pointerType === "mouse" && e.button !== 0 && !(cc && (e.button === 1 || e.button === 2))) return;
    if (e.pointerType !== "mouse" && e.button !== 0) return;
    // A second finger during a press or pan (never an item drag) becomes a pinch.
    if (cc && e.pointerType !== "mouse" && (this.g.kind === "press" || this.g.kind === "pan")) {
      const first = this.pointers.get(this.g.pointerId);
      if (first) {
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        this.el.setPointerCapture(e.pointerId);
        this.g = {
          kind: "pinch",
          a: this.g.pointerId,
          b: e.pointerId,
          dist: Math.hypot(e.clientX - first.x, e.clientY - first.y),
          midX: (first.x + e.clientX) / 2,
          midY: (first.y + e.clientY) / 2,
        };
        this.updateCursor();
      }
      return;
    }
    if (this.g.kind !== "none") return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const id = this.host.pickItem(e.clientX, e.clientY);
    this.el.setPointerCapture(e.pointerId);
    const primary = e.button === 0 && (e.pointerType !== "mouse" || !e.shiftKey);
    if (id && this.host.isEditable() && primary) {
      const info = this.host.itemInfo(id);
      const p = this.host.floorPoint(e.clientX, e.clientY);
      if (info && p && !info.locked) {
        this.g = { kind: "drag", id, offX: info.x - p.x, offZ: info.z - p.z, pointerId: e.pointerId };
        this.host.beginDrag(id);
        this.host.select(id);
        this.updateCursor();
        e.preventDefault();
        return;
      }
      if (info?.locked) this.host.nope(id);
    }
    if (cc && e.pointerType === "mouse") {
      if (e.button === 2 || (e.button === 0 && e.shiftKey)) {
        this.g = { kind: "orbit", lastX: e.clientX, lastY: e.clientY, pointerId: e.pointerId, moved: false };
        this.updateCursor();
        return;
      }
      if (e.button === 1) {
        this.g = { kind: "pan", lastX: e.clientX, lastY: e.clientY, pointerId: e.pointerId };
        this.updateCursor();
        return;
      }
    }
    this.g = { kind: "press", id, x0: e.clientX, y0: e.clientY, pointerId: e.pointerId };
  };

  private onMove = (e: PointerEvent): void => {
    const pt = this.pointers.get(e.pointerId);
    if (pt) {
      pt.x = e.clientX;
      pt.y = e.clientY;
    }
    const g = this.g;
    if (g.kind === "pinch" && (e.pointerId === g.a || e.pointerId === g.b)) {
      const pa = this.pointers.get(g.a);
      const pb = this.pointers.get(g.b);
      if (!pa || !pb) return;
      const dist = Math.hypot(pb.x - pa.x, pb.y - pa.y);
      const midX = (pa.x + pb.x) / 2;
      const midY = (pa.y + pb.y) / 2;
      if (g.dist > 1 && dist > 1) this.host.zoom(dist / g.dist, midX, midY);
      this.host.pan(midX - g.midX, midY - g.midY);
      this.g = { ...g, dist, midX, midY };
      return;
    }
    if (g.kind === "drag" && e.pointerId === g.pointerId) {
      const p = this.host.floorPoint(e.clientX, e.clientY);
      if (p) this.host.dragTo(g.id, p.x + g.offX, p.z + g.offZ);
      return;
    }
    if (g.kind === "pan" && e.pointerId === g.pointerId) {
      const dx = e.clientX - g.lastX;
      const dy = e.clientY - g.lastY;
      if (dx !== 0 || dy !== 0) {
        this.g = { ...g, lastX: e.clientX, lastY: e.clientY };
        this.host.pan(dx, dy);
      }
      return;
    }
    if (g.kind === "orbit" && e.pointerId === g.pointerId) {
      const dx = e.clientX - g.lastX;
      const dy = e.clientY - g.lastY;
      if (Math.abs(dx) + Math.abs(dy) > 0) {
        this.g = { ...g, lastX: e.clientX, lastY: e.clientY, moved: true };
        this.host.orbit(dx, dy);
      }
      return;
    }
    if (g.kind === "press" && e.pointerId === g.pointerId) {
      if (this.host.cameraControls() && Math.hypot(e.clientX - g.x0, e.clientY - g.y0) >= CLICK_SLOP_PX) {
        this.host.pan(e.clientX - g.x0, e.clientY - g.y0);
        this.g = { kind: "pan", lastX: e.clientX, lastY: e.clientY, pointerId: g.pointerId };
        this.updateCursor();
      }
      return;
    }
    if (g.kind === "none" && e.pointerType === "mouse") {
      const id = this.host.pickItem(e.clientX, e.clientY);
      if (id !== this.hoverId) {
        this.hoverId = id;
        this.host.setHover(id);
        this.updateCursor();
      }
    }
  };

  private onUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    const g = this.g;
    // Lifting one pinch finger re-seeds a pan on the remaining one (no jump).
    if (g.kind === "pinch") {
      if (e.pointerId !== g.a && e.pointerId !== g.b) return;
      const other = e.pointerId === g.a ? g.b : g.a;
      const p = this.pointers.get(other);
      this.g = p ? { kind: "pan", lastX: p.x, lastY: p.y, pointerId: other } : { kind: "none" };
      if (this.el.hasPointerCapture(e.pointerId)) this.el.releasePointerCapture(e.pointerId);
      this.updateCursor();
      return;
    }
    if ("pointerId" in g && g.pointerId !== e.pointerId) return;
    if (g.kind === "drag") this.host.endDrag(g.id);
    if (g.kind === "press" && Math.hypot(e.clientX - g.x0, e.clientY - g.y0) < CLICK_SLOP_PX) this.host.select(g.id);
    this.g = { kind: "none" };
    if (this.el.hasPointerCapture(e.pointerId)) this.el.releasePointerCapture(e.pointerId);
    this.updateCursor();
  };

  private onCancel = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    const g = this.g;
    if (g.kind === "pinch") {
      if (e.pointerId !== g.a && e.pointerId !== g.b) return;
      const other = e.pointerId === g.a ? g.b : g.a;
      const p = this.pointers.get(other);
      this.g = p ? { kind: "pan", lastX: p.x, lastY: p.y, pointerId: other } : { kind: "none" };
    } else if ("pointerId" in g && g.pointerId !== e.pointerId) {
      return;
    } else {
      if (g.kind === "drag") this.host.endDrag(g.id);
      this.g = { kind: "none" };
    }
    if (this.el.hasPointerCapture(e.pointerId)) this.el.releasePointerCapture(e.pointerId);
    this.updateCursor();
  };

  private onLeave = (): void => {
    if (this.g.kind === "none" && this.hoverId) {
      this.hoverId = null;
      this.host.setHover(null);
      this.updateCursor();
    }
  };

  private onDbl = (e: MouseEvent): void => {
    const id = this.host.pickItem(e.clientX, e.clientY);
    if (id) {
      if (this.host.allowRotate() && this.host.isEditable()) this.host.rotate(id);
      return;
    }
    if (this.host.cameraControls()) this.host.resetCamera();
  };

  private onWheel = (e: WheelEvent): void => {
    if (!this.host.cameraControls()) return;
    e.preventDefault();
    this.host.zoom(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
  };

  private onContextMenu = (e: Event): void => {
    if (this.host.cameraControls()) e.preventDefault();
  };

  private onKey = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement | null;
    if (target && (target.isContentEditable || /input|textarea|select/i.test(target.tagName))) return;
    if (e.key === "r" || e.key === "R") {
      if (!this.host.allowRotate() || !this.host.isEditable()) return;
      const id = this.dragging ?? this.host.selectedId();
      if (id) this.host.rotate(id);
      return;
    }
    if (!this.host.cameraControls()) return;
    const r = this.el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    if (e.key === "+" || e.key === "=") this.host.zoom(KEY_ZOOM, cx, cy);
    else if (e.key === "-") this.host.zoom(1 / KEY_ZOOM, cx, cy);
    else if (e.key === "0") this.host.resetCamera();
  };

  private updateCursor(): void {
    let c = "default";
    if (this.g.kind === "drag" || this.g.kind === "pan" || this.g.kind === "pinch") c = "grabbing";
    else if (this.g.kind === "orbit") c = "move";
    else if (this.hoverId && this.host.isEditable()) {
      const info = this.host.itemInfo(this.hoverId);
      c = info?.locked ? "not-allowed" : "grab";
    } else if (this.hoverId) c = "pointer";
    else if (this.host.cameraControls()) c = "grab";
    this.el.style.cursor = c;
  }

  /** Re-evaluate cursor after the editable flag changes. */
  refresh(): void {
    this.updateCursor();
  }

  dispose(): void {
    const el = this.el;
    el.removeEventListener("pointerdown", this.onDown);
    el.removeEventListener("pointermove", this.onMove);
    el.removeEventListener("pointerup", this.onUp);
    el.removeEventListener("pointercancel", this.onCancel);
    el.removeEventListener("pointerleave", this.onLeave);
    el.removeEventListener("dblclick", this.onDbl);
    el.removeEventListener("wheel", this.onWheel);
    el.removeEventListener("contextmenu", this.onContextMenu);
    window.removeEventListener("keydown", this.onKey);
  }
}
