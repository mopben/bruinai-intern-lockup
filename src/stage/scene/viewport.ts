/**
 * Renderer, orthographic camera, lights and picking for one scene instance.
 * Sized to its container (ResizeObserver) and to devicePixelRatio.
 */
import * as THREE from "three";
import { palette } from "../theme/tokens";
import { DEFAULT_VIEW, framePoints, rectCorners, type V3, type ViewAngles } from "./framing";
import type { Rect } from "./model";
import { BOARD_PAD_M, BOARD_THICK_M } from "./board";

const MAX_DPR = 2;
const CAMERA_DISTANCE = 30;

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
  private room: Rect = { minX: -2, maxX: 2, minZ: -1.5, maxZ: 1.5 };
  /** Extra points to keep in frame (box tops plus tag room), set by the scene. */
  contentPoints: readonly V3[] = [];
  onResize: (() => void) | null = null;

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
    this.resize();
  }

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
    const f = framePoints(points, this.width / this.height, { view: this.view, zoom: this.zoom, margin: 0.04 });
    const c = this.camera;
    c.left = -f.halfW;
    c.right = f.halfW;
    c.top = f.halfH;
    c.bottom = -f.halfH;
    c.position.set(f.target.x + f.dir.x * CAMERA_DISTANCE, f.target.y + f.dir.y * CAMERA_DISTANCE, f.target.z + f.dir.z * CAMERA_DISTANCE);
    c.up.set(0, 1, 0);
    c.lookAt(f.target.x, f.target.y, f.target.z);
    c.near = 0.1;
    c.far = CAMERA_DISTANCE * 2;
    c.updateProjectionMatrix();
    c.updateMatrixWorld();
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
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.observer.disconnect();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
