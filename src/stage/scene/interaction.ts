/**
 * Pointer handling for one scene: pick, drag, select, rotate, orbit.
 * Mouse, pen and touch all arrive as pointer events. The scene supplies the
 * geometry through `InteractionHost`; this file only decides what a gesture means.
 */

export interface InteractionHost {
  pickItem(clientX: number, clientY: number): string | null;
  floorPoint(clientX: number, clientY: number): { x: number; z: number } | null;
  itemInfo(id: string): { x: number; z: number; locked: boolean } | null;
  isEditable(): boolean;
  allowOrbit(): boolean;
  allowRotate(): boolean;
  selectedId(): string | null;
  beginDrag(id: string): void;
  dragTo(id: string, x: number, z: number): void;
  endDrag(id: string): void;
  nope(id: string): void;
  select(id: string | null): void;
  rotate(id: string): void;
  orbit(dx: number, dy: number): void;
  zoom(factor: number): void;
  setHover(id: string | null): void;
}

/** A press that moves less than this (CSS px) is a click. */
const CLICK_SLOP_PX = 7;

type Gesture =
  | { kind: "none" }
  | { kind: "press"; id: string | null; x0: number; y0: number; pointerId: number }
  | { kind: "drag"; id: string; offX: number; offZ: number; pointerId: number }
  | { kind: "orbit"; lastX: number; lastY: number; pointerId: number; moved: boolean };

export class Interaction {
  private g: Gesture = { kind: "none" };
  private hoverId: string | null = null;

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
    window.addEventListener("keydown", this.onKey);
  }

  get dragging(): string | null {
    return this.g.kind === "drag" ? this.g.id : null;
  }

  private onDown = (e: PointerEvent): void => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const id = this.host.pickItem(e.clientX, e.clientY);
    this.el.setPointerCapture(e.pointerId);
    if (id && this.host.isEditable()) {
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
    if (!id && this.host.allowOrbit()) {
      this.g = { kind: "orbit", lastX: e.clientX, lastY: e.clientY, pointerId: e.pointerId, moved: false };
      return;
    }
    this.g = { kind: "press", id, x0: e.clientX, y0: e.clientY, pointerId: e.pointerId };
  };

  private onMove = (e: PointerEvent): void => {
    const g = this.g;
    if (g.kind === "drag" && e.pointerId === g.pointerId) {
      const p = this.host.floorPoint(e.clientX, e.clientY);
      if (p) this.host.dragTo(g.id, p.x + g.offX, p.z + g.offZ);
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
    const g = this.g;
    if ("pointerId" in g && g.pointerId !== e.pointerId) return;
    if (g.kind === "drag") this.host.endDrag(g.id);
    if (g.kind === "press" && Math.hypot(e.clientX - g.x0, e.clientY - g.y0) < CLICK_SLOP_PX) this.host.select(g.id);
    if (g.kind === "orbit" && !g.moved) this.host.select(null);
    this.g = { kind: "none" };
    if (this.el.hasPointerCapture(e.pointerId)) this.el.releasePointerCapture(e.pointerId);
    this.updateCursor();
  };

  private onCancel = (e: PointerEvent): void => {
    const g = this.g;
    if (g.kind === "drag") this.host.endDrag(g.id);
    this.g = { kind: "none" };
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
    if (!this.host.allowRotate() || !this.host.isEditable()) return;
    const id = this.host.pickItem(e.clientX, e.clientY);
    if (id) this.host.rotate(id);
  };

  private onWheel = (e: WheelEvent): void => {
    if (!this.host.allowOrbit()) return;
    e.preventDefault();
    this.host.zoom(Math.exp(-e.deltaY * 0.0015));
  };

  private onKey = (e: KeyboardEvent): void => {
    if (e.key !== "r" && e.key !== "R") return;
    if (!this.host.allowRotate() || !this.host.isEditable()) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.isContentEditable || /input|textarea|select/i.test(target.tagName))) return;
    const id = this.dragging ?? this.host.selectedId();
    if (id) this.host.rotate(id);
  };

  private updateCursor(): void {
    let c = "default";
    if (this.g.kind === "drag") c = "grabbing";
    else if (this.g.kind === "orbit") c = "move";
    else if (this.hoverId && this.host.isEditable()) {
      const info = this.host.itemInfo(this.hoverId);
      c = info?.locked ? "not-allowed" : "grab";
    } else if (this.hoverId) c = "pointer";
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
    window.removeEventListener("keydown", this.onKey);
  }
}
