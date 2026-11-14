/**
 * The kitchen scene: glue between the data, the three.js views, the HTML
 * overlay and the pointer controller. See ./index.ts for the public API.
 */
import * as THREE from "three";
import { FORMAT_VERSION, LAYOUT_FORMAT, type Layout } from "../../core/types";
import type { KitchenInput, KitchenSceneHandle, KitchenSceneOptions, LabelMode, PathInput, SceneDebug, WorkerInput } from "./api";
import { Board } from "./board";
import { resolveMove, overlaps } from "./collision";
import { GhostLayer, PathLayer } from "./floor-marks";
import { Interaction } from "./interaction";
import { ItemView } from "./item-view";
import { BadgeView, Overlay, TagView } from "./labels";
import { GeometryCache } from "./kit";
import {
  blocks, dragArea, footprintHalf, footprintRect, lockReason, nextQuarterTurn, resolveItems, resolveWalls, roomBounds,
  withPlacement, type Rect, type SceneItem,
} from "./model";
import { Pawns } from "./pawns";
import { NO_ALERT, nextAlert, type AlertState } from "./pile-alert";
import { TicketPile, ticketMaterials } from "./tickets";
import { Tweens } from "./tweens";
import { Viewport } from "./viewport";

/** Height above a box top reserved for its name tag when framing, metres. */
const TAG_ROOM_M = 0.4;
const EMPTY_LAYOUT: Layout = { format: LAYOUT_FORMAT, version: FORMAT_VERSION, placements: {}, workers: [] };

interface PileEntry { readonly pile: TicketPile; readonly badge: BadgeView; }

export function createKitchenScene(container: HTMLElement, options: KitchenSceneOptions = {}): KitchenSceneHandle {
  const vp = new Viewport(container);
  const geo = new GeometryCache();
  const overlay = new Overlay(container);
  const board = new Board(geo);
  const world = new THREE.Group();
  const pawns = new Pawns(geo);
  const paths = new PathLayer(geo);
  const ghosts = new GhostLayer();
  const tmats = ticketMaterials();
  const tweens = new Tweens();
  vp.scene.add(board.group, ghosts.group, paths.group, world, pawns.group);
  const homeView = options.view ?? vp.view;
  vp.alignV = options.alignV ?? "center";
  vp.view = homeView;

  const views = new Map<string, ItemView>();
  const tags = new Map<string, TagView>();
  const piles = new Map<string, PileEntry>();
  let alertState: AlertState = NO_ALERT;
  let input: KitchenInput | null = null;
  let layout: Layout = EMPTY_LAYOUT;
  let items: readonly SceneItem[] = [];
  let room: Rect | null = null;
  let lastFrameKey = "";
  let area: Rect = { minX: -2, maxX: 2, minZ: -2, maxZ: 2 };
  let mode: LabelMode = options.initialLabels ?? "names";
  let paintMix = mode === "names" ? 1 : 0;
  let editable = false;
  let selected: string | null = null;
  let hover: string | null = null;
  let dragId: string | null = null;
  let ghostLayout: Layout | null = null;
  let queues: Readonly<Record<string, number>> = {};
  let shownWorkers: readonly WorkerInput[] = [];
  let dirty = true;
  let disposed = false;
  let raf = 0;
  let last = performance.now() / 1000;
  const v3 = new THREE.Vector3();

  const now = () => performance.now() / 1000;
  const markDirty = () => { dirty = true; };
  let ready = false;
  vp.onResize = () => {
    if (overlay.resize(vp.width, vp.height)) for (const t of tags.values()) t.placed.measured = false;
    markDirty();
    // Resizing clears the canvas. Draw now, before the browser paints, so a
    // projector changing mode never shows an empty table for a frame.
    if (ready && !disposed) drawNow();
  };
  vp.onResize();
  vp.onWake = markDirty;

  function itemById(id: string): SceneItem | undefined {
    return items.find((i) => i.id === id);
  }

  function applyPaint(): void {
    for (const v of views.values()) {
      v.paintMix = paintMix;
      v.selected = v.item.id === selected;
      v.hovered = v.item.id === hover && editable;
      v.applyPaint();
    }
    markDirty();
  }

  function refreshGhost(): void {
    if (!ghostLayout || !input) { ghosts.set([]); return; }
    const entries = [];
    for (const it of items) {
      if (it.role === "ignore") continue;
      const box = input.scan.boxes.find((b) => b.id === it.id);
      const g = ghostLayout.placements[it.id] ?? (box ? { x: box.center.x, z: box.center.z, yaw: box.yaw } : null);
      if (!g) continue;
      if (Math.hypot(g.x - it.x, g.z - it.z) > 0.01 || Math.abs(g.yaw - it.yaw) > 1e-3) entries.push({ item: it, x: g.x, z: g.z, yaw: g.yaw });
    }
    ghosts.set(entries);
    markDirty();
  }

  function syncItems(): void {
    if (!input) return;
    items = resolveItems({ ...input, layout });
    const seen = new Set<string>();
    for (const it of items) {
      seen.add(it.id);
      let v = views.get(it.id);
      if (!v) {
        v = new ItemView(it, geo);
        views.set(it.id, v);
        world.add(v.root);
        tags.set(it.id, new TagView(overlay.el));
      } else v.sync(it);
    }
    for (const [id, v] of views) {
      if (seen.has(id)) continue;
      world.remove(v.root);
      v.dispose();
      views.delete(id);
      tags.get(id)?.remove();
      tags.delete(id);
      const p = piles.get(id);
      if (p) { p.badge.remove(); piles.delete(id); }
    }
    applyPaint();
  }

  function setKitchen(next: KitchenInput): void {
    const held = dragId ? layout.placements[dragId] : undefined;
    input = next;
    layout = next.layout ?? EMPTY_LAYOUT;
    if (dragId && held) layout = withPlacement(layout, dragId, held);
    const base = { scan: next.scan, setup: next.setup };
    const r = roomBounds(base);
    // Keep each box top plus room for its name tag in frame (scan positions, so a drag never reframes).
    const tops = next.scan.boxes.map((b) => ({ x: b.center.x, y: b.size.h + TAG_ROOM_M, z: b.center.z - b.size.d / 2 }));
    const frameKey = JSON.stringify([r, tops]);
    if (frameKey !== lastFrameKey) {
      lastFrameKey = frameKey;
      room = r;
      vp.contentPoints = tops;
      vp.setRoom(r);
      options.onCameraChange?.(cameraMoved());
    }
    area = dragArea(base);
    board.update(r, resolveWalls(next.scan));
    syncItems();
    setQueues(queues);
    refreshGhost();
  }

  function obstaclesFor(id: string): Rect[] {
    return items.filter((i) => i.id !== id && blocks(i)).map((i) => footprintRect(i.size, i.x, i.z, i.yaw));
  }

  function commitPlacement(id: string, x: number, z: number, yaw: number): void {
    layout = withPlacement(layout, id, { x, z, yaw });
    const it = itemById(id);
    if (it) {
      items = items.map((i) => (i.id === id ? { ...i, x, z, yaw } : i));
      views.get(id)?.sync({ ...it, x, z, yaw });
    }
    refreshGhost();
    markDirty();
    options.onLayoutChange?.(layout);
  }

  function nope(id: string, withHint: boolean): void {
    const v = views.get(id);
    const it = itemById(id);
    if (!v || !it) return;
    v.shake(now());
    if (withHint) {
      const text = options.lockHint?.(it) ?? lockReason(it);
      const p = vp.project(v.labelAnchor(v3));
      overlay.showHint(text, p.x, p.y - overlay.fontSize * 1.6, now());
    }
    markDirty();
  }

  const interaction = new Interaction(vp.renderer.domElement, {
    pickItem: (cx, cy) => {
      const targets = [...views.values()].filter((v) => v.root.visible && v.hit.visible && v.appear > 0.5).map((v) => v.hit);
      return (vp.pick(cx, cy, targets)?.object.userData.boxId as string | undefined) ?? null;
    },
    floorPoint: (cx, cy) => vp.floorPoint(cx, cy),
    itemInfo: (id) => { const it = itemById(id); return it ? { x: it.x, z: it.z, locked: it.locked } : null; },
    isEditable: () => editable,
    cameraControls: () => !!options.cameraControls,
    allowRotate: () => options.allowRotate !== false,
    selectedId: () => selected,
    beginDrag: (id) => { dragId = id; const v = views.get(id); if (v) v.liftTarget = 1; markDirty(); },
    dragTo: (id, x, z) => {
      const it = itemById(id);
      if (!it) return;
      const { hx, hz } = footprintHalf(it.size, it.yaw);
      const r = resolveMove({ hx, hz, from: it, to: { x, z }, area, obstacles: obstaclesFor(id) });
      if (Math.abs(r.x - it.x) > 1e-4 || Math.abs(r.z - it.z) > 1e-4) commitPlacement(id, r.x, r.z, it.yaw);
    },
    endDrag: (id) => {
      dragId = null;
      const v = views.get(id);
      if (v) v.liftTarget = 0;
      markDirty();
      options.onLayoutCommit?.(layout);
    },
    nope: (id) => nope(id, true),
    select: (id) => { setSelected(id); options.onSelect?.(id); },
    rotate: (id) => {
      const it = itemById(id);
      if (!it) return;
      if (it.locked) { nope(id, true); return; }
      const yaw = nextQuarterTurn(it.yaw);
      const { hx, hz } = footprintHalf(it.size, yaw);
      const obstacles = obstaclesFor(id);
      const r = resolveMove({ hx, hz, from: it, to: it, area, obstacles });
      const rect = { minX: r.x - hx, maxX: r.x + hx, minZ: r.z - hz, maxZ: r.z + hz };
      if (obstacles.some((o) => overlaps(rect, o))) { nope(id, false); return; }
      commitPlacement(id, r.x, r.z, yaw);
      if (!dragId) options.onLayoutCommit?.(layout);
    },
    orbit: (dx, dy) => {
      vp.view = { azimuth: vp.view.azimuth - dx * 0.006, elevation: Math.min(1.35, Math.max(0.45, vp.view.elevation + dy * 0.004)) };
      vp.applyFrame();
      cameraChanged();
    },
    pan: (dx, dy) => { vp.panBy(dx, dy); cameraChanged(); },
    zoom: (f, cx, cy) => {
      const r = vp.renderer.domElement.getBoundingClientRect();
      vp.zoomAt(f, cx - r.left, cy - r.top);
      cameraChanged();
    },
    resetCamera: () => reframe(),
    setHover: (id) => { hover = id; applyPaint(); },
  });

  function cameraMoved(): boolean {
    return vp.pan.x !== 0 || vp.pan.y !== 0 || vp.pan.z !== 0 || vp.zoom !== 1 || vp.view.azimuth !== homeView.azimuth || vp.view.elevation !== homeView.elevation;
  }

  function cameraChanged(): void {
    markDirty();
    options.onCameraChange?.(cameraMoved());
  }

  function reframe(): void {
    vp.view = homeView;
    vp.zoom = 1;
    vp.pan = { x: 0, y: 0, z: 0 };
    vp.applyFrame();
    cameraChanged();
  }

  function setSelected(id: string | null): void {
    selected = id;
    applyPaint();
  }

  function setQueues(counts: Readonly<Record<string, number>>): void {
    queues = { ...counts };
    const t = now();
    const ids = new Set([...Object.keys(queues), ...piles.keys()]);
    for (const id of ids) {
      const v = views.get(id);
      if (!v) continue;
      let entry = piles.get(id);
      if (!entry) {
        entry = { pile: new TicketPile(geo, tmats.paper, tmats.alert), badge: new BadgeView(overlay.el) };
        piles.set(id, entry);
      }
      if (entry.pile.group.parent !== v.root) v.root.add(entry.pile.group);
      entry.pile.setCount(queues[id] ?? 0, alertState.on === id, t);
      entry.badge.set(entry.pile.count, entry.pile.alert);
    }
    updateAlert(t);
    markDirty();
  }

  /** Re-decides the bottleneck (stations only) and repaints the piles whose alert changed. */
  function updateAlert(t: number): boolean {
    const counts: Record<string, number> = {};
    for (const it of items) if (it.role === "station") counts[it.id] = queues[it.id] ?? 0;
    const next = nextAlert(alertState, counts, t);
    const changed = next.on !== alertState.on;
    alertState = next;
    if (!changed) return false;
    for (const [id, e] of piles) {
      e.pile.setCount(e.pile.count, alertState.on === id, t);
      e.badge.set(e.pile.count, e.pile.alert);
    }
    return true;
  }

  const headBuf: THREE.Vector3[] = [];
  function layoutOverlay(): void {
    const scanMode = mode === "scan";
    // Badges first: they mark the piles and must never be covered.
    const blockers = [];
    for (const [id, e] of piles) {
      const v = views.get(id);
      if (!v) continue;
      v.pileLocal(v3);
      e.pile.group.position.copy(v3);
      v3.y += e.pile.height + 0.12;
      v3.applyMatrix4(v.root.matrixWorld);
      const p = vp.project(v3);
      const r = overlay.placeCentered(e.badge.placed, p.x, p.y - overlay.fontSize * 0.4, e.pile.count > 0 && v.root.visible);
      if (r) blockers.push(r);
    }
    const n = pawns.heads(headBuf);
    const see = [];
    for (let i = 0; i < n; i++) { const p = vp.project(headBuf[i]!); see.push({ x: p.x, y: p.y }); }
    const list = [];
    for (const [id, v] of views) {
      const tag = tags.get(id);
      if (!tag) continue;
      const it = v.item;
      const hidden = (it.role === "ignore" && !scanMode) || !v.root.visible;
      tag.set({
        name: it.name, category: it.category, role: it.role, locked: it.locked, movable: editable && !it.locked && it.role !== "ignore",
        scanMode, selected: id === selected, hidden: false,
      });
      const p = vp.project(v.labelAnchor(v3));
      list.push({ placed: tag.placed, x: p.x, y: p.y, depth: p.depth, visible: !hidden && v.appear > 0.6 });
    }
    const keepOut = options.labelKeepOut?.() ?? [];
    overlay.layoutTags(list, [...keepOut, ...blockers], see);
    const placed = overlay.setPathTags(paths.labels.filter((_, i) => paths.midpoints[i]));
    let k = 0;
    paths.midpoints.forEach((m) => {
      if (!m) return;
      const tag = placed[k++];
      if (tag) { const p = vp.project(v3.set(m.x, 0.02, m.z)); overlay.placeCentered(tag, p.x, p.y, true); }
    });
  }

  function frame(): void {
    if (disposed) return;
    raf = requestAnimationFrame(frame);
    const t = now();
    const dt = Math.min(0.05, Math.max(0, t - last));
    last = t;
    let busy = tweens.tick(t);
    if (updateAlert(t)) busy = true;
    for (const v of views.values()) {
      const pile = piles.get(v.item.id)?.pile;
      const pulse = pile?.alert && v.item.role === "station" ? 0.5 + 0.5 * Math.sin(t * 4.5) : 0;
      if (pulse !== v.pulse) { v.pulse = pulse; v.applyPaint(); busy = true; }
      if (v.tick(t, dt)) busy = true;
      if (pile && pile.tick(t)) busy = true;
    }
    if (pawns.tick(t, dt)) busy = true;
    if (overlay.tick(t)) busy = true;
    if (!dirty && !busy) return;
    drawNow();
  }

  function drawNow(): void {
    dirty = false;
    world.updateMatrixWorld();
    layoutOverlay();
    vp.render();
  }
  raf = requestAnimationFrame(frame);
  ready = true;
  void document.fonts?.ready.then(() => {
    if (disposed) return;
    if (room) board.redrawText(room);
    for (const t of tags.values()) t.placed.measured = false;
    markDirty();
  });

  function showNames(): Promise<void> {
    mode = "names";
    const from = paintMix;
    markDirty();
    return tweens.run(0.9, (p) => { paintMix = from + (1 - from) * p; applyPaint(); });
  }

  function playReveal(): Promise<void> {
    mode = "scan";
    paintMix = 0;
    applyPaint();
    const order = [...views.values()].sort((a, b) => a.item.z - b.item.z || a.item.x - b.item.x);
    const stagger = Math.min(0.26, 1.9 / Math.max(1, order.length));
    const t = now();
    order.forEach((v, i) => v.startAppear(t, 0.15 + i * stagger));
    markDirty();
    return tweens.wait(0.15 + order.length * stagger + 0.55);
  }

  return {
    setKitchen,
    playReveal,
    showNames,
    showScanLabels: () => { mode = "scan"; paintMix = 0; applyPaint(); },
    setEditable: (on) => { editable = on; interaction.refresh(); applyPaint(); },
    setSelected,
    setWorkers: (ws: readonly WorkerInput[]) => { shownWorkers = ws; pawns.set(ws, now()); markDirty(); },
    setQueues,
    setPaths: (ps: readonly PathInput[]) => { paths.set(ps); markDirty(); },
    setGhost: (l) => { ghostLayout = l; refreshGhost(); },
    projectToScreen: (x, y, z) => { const p = vp.project(v3.set(x, y, z)); return Number.isFinite(p.x) ? { x: p.x, y: p.y } : null; },
    reframe,
    debug: (): SceneDebug => {
      const rect = container.getBoundingClientRect();
      const screen: Record<string, { x: number; y: number }> = {};
      for (const it of items) {
        const p = vp.project(v3.set(it.x, it.size.h, it.z));
        screen[it.id] = { x: rect.left + p.x, y: rect.top + p.y };
      }
      return {
        items: items.map((i) => ({ id: i.id, name: i.name, role: i.role, locked: i.locked, x: i.x, z: i.z, h: i.size.h })),
        queues: { ...queues },
        alerts: [...piles].filter(([, e]) => e.pile.alert).map(([id]) => id),
        workers: shownWorkers.map((w) => ({ id: w.id, x: w.x, z: w.z })),
        renders: vp.renders,
        lastRenderAt: vp.lastRenderAt,
        contextLost: vp.contextLost,
        contextRestored: vp.contextRestored,
        width: vp.width,
        height: vp.height,
        bufferWidth: vp.renderer.domElement.width,
        bufferHeight: vp.renderer.domElement.height,
        screen,
      };
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      tweens.cancelAll();
      interaction.dispose();
      for (const v of views.values()) v.dispose();
      pawns.dispose();
      paths.dispose();
      ghosts.dispose();
      board.dispose();
      tmats.paper.dispose();
      tmats.alert.dispose();
      geo.dispose();
      overlay.dispose();
      vp.dispose();
    },
  };
}
