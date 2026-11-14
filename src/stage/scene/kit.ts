/**
 * Small three.js helpers shared by the scene parts: a geometry cache that is
 * disposed with the scene, paint materials and colour mixing.
 */
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

export class GeometryCache {
  private readonly map = new Map<string, THREE.BufferGeometry>();

  get<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
    const hit = this.map.get(key);
    if (hit) return hit as T;
    const g = make();
    this.map.set(key, g);
    return g;
  }

  roundedBox(w: number, h: number, d: number, radius: number): THREE.BufferGeometry {
    const r = Math.max(0.002, Math.min(radius, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001));
    const key = `rb:${w.toFixed(3)}:${h.toFixed(3)}:${d.toFixed(3)}:${r.toFixed(3)}`;
    return this.get(key, () => new RoundedBoxGeometry(w, h, d, 3, r));
  }

  dispose(): void {
    for (const g of this.map.values()) g.dispose();
    this.map.clear();
  }
}

export function paint(color: THREE.ColorRepresentation, opts: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0, ...opts });
}

/** Back-face hull used as a cartoon outline. */
export function outlineMaterial(color: THREE.ColorRepresentation, opacity = 1): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    side: THREE.BackSide,
    transparent: opacity < 1,
    opacity,
  });
}

const tmpA = new THREE.Color();
const tmpB = new THREE.Color();

/** Write the mix of two hex colours into `out` without allocating. */
export function mixInto(out: THREE.Color, a: string, b: string, t: number): THREE.Color {
  tmpA.set(a);
  tmpB.set(b);
  return out.copy(tmpA).lerp(tmpB, Math.min(1, Math.max(0, t)));
}

export function setShadows(obj: THREE.Object3D, cast: boolean, receive: boolean): void {
  obj.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = cast;
      o.receiveShadow = receive;
    }
  });
}

/** Dispose every material on meshes under obj (geometry is owned by the cache). */
export function disposeMaterials(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (!m) return;
    const list = Array.isArray(m) ? m : [m];
    for (const mat of list) {
      const map = (mat as THREE.MeshStandardMaterial).map;
      if (map) map.dispose();
      mat.dispose();
    }
  });
}
