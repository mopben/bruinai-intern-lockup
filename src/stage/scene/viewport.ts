/**
 * Renderer, orthographic camera, lights and picking for one scene instance.
 * Sized to its container (ResizeObserver) and to devicePixelRatio.
 */
import * as THREE from "three";
import { palette } from "../theme/tokens";
import { DEFAULT_VIEW, cameraAxes, clampPan, framePoints, panDelta, rectCorners, viewDir, zoomAtDelta, type V3, type ViewAngles } from "./framing";
import type { Rect } from "./model";
import { BOARD_PAD_M, BOARD_THICK_M } from "./board";

const MAX_DPR = 2;
const CAMERA_DISTANCE = 30;
const MIN_ZOOM = 0.6;
const MAX_ZOOM = 4;

export class Viewport {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  private readonly sun = new THREE.DirectionalLight("#fff4e2", 2.1);
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly hitPoint = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly observer: ResizeObserver;
  width = 1;
  height = 1;
  view: ViewAngles = DEFAULT_VIEW;
  zoom = 1;
  /** World-space offset added to the framing target (pan). */
  pan: V3 = { x: 0, y: 0, z: 0 };
  alignV: "center" | "bottom" = "center";
  /** Frustum half sizes from the last applyFrame (world units). */
  halfW = 1;
  halfH = 1;
  private room: Rect = { minX: -2, maxX: 2, minZ: -1.5, maxZ: 1.5 };
  /** Extra points to keep in frame (box tops plus tag room), set by the scene. */
  contentPoints: readonly V3[] = [];
  onResize: (() => void) | null = null;
  /** TEST HOOK counters (KitchenSceneHandle.debug). */
  renders = 0;
  lastRenderAt = 0;
  contextLost = 0;
  contextRestored = 0;

  constructor(readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    this.renderer.setClearColor(palette.table, 1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    const canvas = this.renderer.domElement;
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.setAttribute("aria-label", "Kitchen model");
    if (getComputedStyle(container).position === "static") container.style.position = "relative";
    container.appendChild(canvas);

    const hemi = new THREE.HemisphereLight("#fff8ec", "#d9c7a6", 1.55);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.radius = 6;
    this.sun.shadow.blurSamples = 16;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(hemi, this.sun, this.sun.target);

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    canvas.addEventListener("webglcontextlost", this.onContextLost);
    canvas.addEventListener("webglcontextrestored", this.onContextRestored);
    window.addEventListener("resize", this.onWindowChange);
    document.addEventListener("visibilitychange", this.onWindowChange);
    document.addEventListener("fullscreenchange", this.onWindowChange);
    this.watchPixelRatio();
    // Safety net: a size change that no event reported (seen on some projectors) is caught within a second.
    this.watchdog = setInterval(() => this.resize(), 1000);
    this.resize();
  }

  /** Called when the view must be drawn again although nothing in the scene changed (tab shown, context restored). */
  onWake: (() => void) | null = null;
  private readonly watchdog: ReturnType<typeof setInterval>;
  private dprQuery: MediaQueryList | null = null;
  private lost = false;

  private readonly onWindowChange = (): void => {
    if (document.visibilityState === "hidden") return;
    this.resize();
    this.onWake?.();
  };

  private readonly onDprChange = (): void => {
    this.watchPixelRatio();
    this.onWindowChange();
  };

  /** devicePixelRatio changes (window moved to the projector) fire no resize; a media query does. */
  private watchPixelRatio(): void {
    this.dprQuery?.removeEventListener("change", this.onDprChange);
    this.dprQuery = typeof window.matchMedia === "function" ? window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`) : null;
    this.dprQuery?.addEventListener("change", this.onDprChange);
  }

  private readonly onContextLost = (): void => {
    // three.js calls preventDefault, which asks the browser to restore the context.
    this.lost = true;
    this.contextLost += 1;
  };

  private readonly onContextRestored = (): void => {
    this.lost = false;
    this.contextRestored += 1;
    // three.js re-creates its GL state; buffers and textures upload again on the next draw.
    this.width = 0;
    this.resize();
    this.onWake?.();
  };

  resize(): void {
    const r = this.container.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    if (w === this.width && h === this.height && this.renderer.getPixelRatio() === dpr) return;
    this.width = w;
    this.height = h;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.applyFrame();
    this.onResize?.();
  }

  setRoom(room: Rect): void {
    this.room = room;
    this.pan = { x: 0, y: 0, z: 0 };
    this.zoom = 1;
    this.applyFrame();
    // Shadow camera covers the room with a margin; light from front-left above.
    const cx = (room.minX + room.maxX) / 2;
    const cz = (room.minZ + room.maxZ) / 2;
    const span = Math.max(room.maxX - room.minX, room.maxZ - room.minZ) / 2 + 1.2;
    this.sun.position.set(cx - 3.5, 9, cz + 4.5);
    this.sun.target.position.set(cx, 0, cz);
    const sc = this.sun.shadow.camera;
    sc.left = -span;
    sc.right = span;
    sc.top = span;
    sc.bottom = -span;
    sc.near = 1;
    sc.far = 25;
    sc.updateProjectionMatrix();
  }

  applyFrame(): void {
    const pad = BOARD_PAD_M + 0.06;
    const board = { minX: this.room.minX - pad, maxX: this.room.maxX + pad, minZ: this.room.minZ - pad, maxZ: this.room.maxZ + pad };
    const points = [...rectCorners(board, -BOARD_THICK_M - 0.05, 0), ...this.contentPoints];
    const f = framePoints(points, this.width / this.height, { view: this.view, zoom: this.zoom, margin: 0.04, alignV: this.alignV });
    this.halfW = f.halfW;
    this.halfH = f.halfH;
    const t = { x: f.target.x + this.pan.x, y: f.target.y + this.pan.y, z: f.target.z + this.pan.z };
    const c = this.camera;
    c.left = -f.halfW;
    c.right = f.halfW;
    c.top = f.halfH;
    c.bottom = -f.halfH;
    c.position.set(t.x + f.dir.x * CAMERA_DISTANCE, t.y + f.dir.y * CAMERA_DISTANCE, t.z + f.dir.z * CAMERA_DISTANCE);
    c.up.set(0, 1, 0);
    c.lookAt(t.x, t.y, t.z);
    c.near = 0.1;
    c.far = CAMERA_DISTANCE * 2;
    c.updateProjectionMatrix();
    c.updateMatrixWorld();
  }

  /** Furthest the room centre may be dragged from the frame centre, metres. */
  private panLimit(): number {
    return Math.max(this.room.maxX - this.room.minX, this.room.maxZ - this.room.minZ) / 2 + 1;
  }

  /** Pan by a pointer drag of (dxPx, dyPx) CSS px; the content follows the pointer. */
  panBy(dxPx: number, dyPx: number): void {
    const { right, up } = cameraAxes(viewDir(this.view));
    const d = panDelta(right, up, dxPx, dyPx, (2 * this.halfW) / this.width);
    this.pan = clampPan({ x: this.pan.x + d.x, y: this.pan.y + d.y, z: this.pan.z + d.z }, this.panLimit());
    this.applyFrame();
  }

  /** Zoom by `factor` keeping the world point under (cssX, cssY) fixed; css px inside the container. */
  zoomAt(factor: number, cssX: number, cssY: number): void {
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom * factor));
    if (next === this.zoom) return;
    const { right, up } = cameraAxes(viewDir(this.view));
    const wppOld = (2 * this.halfW) / this.width;
    const wppNew = wppOld * (this.zoom / next);
    const d = zoomAtDelta(right, up, cssX, cssY, this.width, this.height, wppOld, wppNew);
    this.pan = clampPan({ x: this.pan.x + d.x, y: this.pan.y + d.y, z: this.pan.z + d.z }, this.panLimit());
    this.zoom = next;
    this.applyFrame();
  }

  private setNdc(clientX: number, clientY: number): void {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
  }

  pick(clientX: number, clientY: number, targets: readonly THREE.Object3D[]): THREE.Intersection | null {
    this.setNdc(clientX, clientY);
    const hits = this.raycaster.intersectObjects(targets as THREE.Object3D[], false);
    return hits[0] ?? null;
  }

  floorPoint(clientX: number, clientY: number): { x: number; z: number } | null {
    this.setNdc(clientX, clientY);
    const p = this.raycaster.ray.intersectPlane(this.floorPlane, this.hitPoint);
    return p ? { x: p.x, z: p.z } : null;
  }

  /** World point to CSS px inside the container. Writes into a reused vector. */
  project(v: THREE.Vector3): { x: number; y: number; depth: number } {
    this.tmp.copy(v).project(this.camera);
    return { x: (this.tmp.x * 0.5 + 0.5) * this.width, y: (-this.tmp.y * 0.5 + 0.5) * this.height, depth: this.tmp.z };
  }

  render(): void {
    if (this.lost) return;
    this.renderer.render(this.scene, this.camera);
    this.renders += 1;
    this.lastRenderAt = performance.now();
  }

  dispose(): void {
    this.observer.disconnect();
    clearInterval(this.watchdog);
    const canvas = this.renderer.domElement;
    canvas.removeEventListener("webglcontextlost", this.onContextLost);
    canvas.removeEventListener("webglcontextrestored", this.onContextRestored);
    window.removeEventListener("resize", this.onWindowChange);
    document.removeEventListener("visibilitychange", this.onWindowChange);
    document.removeEventListener("fullscreenchange", this.onWindowChange);
    this.dprQuery?.removeEventListener("change", this.onDprChange);
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
