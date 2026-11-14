/**
 * Cheap recognisable details placed on top of (or on the face of) a box, picked
 * from the owner's name or the scan category. They never change the box size.
 */
import * as THREE from "three";
import type { SceneItem } from "./model";
import { GeometryCache, paint } from "./kit";

const CUP = "#fffaf0";
const DARK = "#4a3d35";
const STEEL = "#c9c4bd";

type Maker = (it: SceneItem, geo: GeometryCache) => THREE.Object3D;

function cup(geo: GeometryCache, x: number, z: number, y: number, scale = 1): THREE.Mesh {
  const g = geo.get(`cup`, () => new THREE.CylinderGeometry(0.055, 0.042, 0.1, 18));
  const m = new THREE.Mesh(g, paint(CUP));
  m.position.set(x, y + 0.05 * scale, z);
  m.scale.setScalar(scale);
  return m;
}

const espresso: Maker = (it, geo) => {
  const g = new THREE.Group();
  const { w, h, d } = it.size;
  const head = new THREE.Mesh(geo.roundedBox(Math.min(0.42, w * 0.55), 0.16, Math.min(0.2, d * 0.4), 0.04), paint(DARK));
  head.position.set(-w * 0.12, h + 0.08, -d * 0.2);
  const spout = new THREE.Mesh(geo.get("spout", () => new THREE.CylinderGeometry(0.03, 0.03, 0.08, 12)), paint(STEEL, { metalness: 0.3 }));
  spout.position.set(-w * 0.12, h + 0.04, -d * 0.02);
  g.add(head, spout, cup(geo, -w * 0.12, d * 0.08, h), cup(geo, w * 0.12, d * 0.18, h));
  return g;
};

const till: Maker = (it, geo) => {
  const g = new THREE.Group();
  const { w, h, d } = it.size;
  const base = new THREE.Mesh(geo.roundedBox(0.26, 0.08, 0.22, 0.03), paint(DARK));
  base.position.set(-w * 0.22, h + 0.04, 0);
  const screen = new THREE.Mesh(geo.roundedBox(0.26, 0.18, 0.03, 0.012), paint("#8fd3c4", { emissive: "#3c8f80", emissiveIntensity: 0.35 }));
  screen.position.set(-w * 0.22, h + 0.17, -0.06);
  screen.rotation.x = -0.35;
  g.add(base, screen);
  void d;
  return g;
};

const fridge: Maker = (it, geo) => {
  const g = new THREE.Group();
  const { w, h, d } = it.size;
  const handle = new THREE.Mesh(geo.roundedBox(0.04, h * 0.45, 0.04, 0.015), paint(STEEL, { metalness: 0.3 }));
  handle.position.set(w * 0.32, h * 0.6, d / 2 + 0.025);
  const seam = new THREE.Mesh(geo.roundedBox(w * 0.92, 0.015, 0.01, 0.004), paint(DARK));
  seam.position.set(0, h * 0.32, d / 2 + 0.006);
  const milk = new THREE.Mesh(geo.roundedBox(0.1, 0.18, 0.1, 0.02), paint(CUP));
  milk.position.set(-w * 0.2, h + 0.09, 0);
  const lid = new THREE.Mesh(geo.roundedBox(0.06, 0.04, 0.06, 0.01), paint("#5b8fd6"));
  lid.position.set(-w * 0.2, h + 0.2, 0);
  g.add(handle, seam, milk, lid);
  return g;
};

const sink: Maker = (it, geo) => {
  const g = new THREE.Group();
  const { w, h, d } = it.size;
  const basin = new THREE.Mesh(geo.roundedBox(w * 0.6, 0.02, d * 0.55, 0.008), paint("#8fa7ad", { metalness: 0.2 }));
  basin.position.set(0, h + 0.005, d * 0.05);
  const post = new THREE.Mesh(geo.get("tap", () => new THREE.CylinderGeometry(0.025, 0.025, 0.2, 12)), paint(STEEL, { metalness: 0.4 }));
  post.position.set(0, h + 0.1, -d * 0.36);
  const arm = new THREE.Mesh(geo.roundedBox(0.04, 0.04, 0.16, 0.015), paint(STEEL, { metalness: 0.4 }));
  arm.position.set(0, h + 0.2, -d * 0.3);
  g.add(basin, post, arm);
  return g;
};

const bell: Maker = (it, geo) => {
  const g = new THREE.Group();
  const { w, h } = it.size;
  const dome = new THREE.Mesh(
    geo.get("bell", () => new THREE.SphereGeometry(0.08, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2)),
    paint("#e8c35a", { metalness: 0.35, roughness: 0.4 }),
  );
  dome.position.set(-w * 0.25, h + 0.012, 0);
  const plate = new THREE.Mesh(geo.get("bellplate", () => new THREE.CylinderGeometry(0.1, 0.1, 0.02, 20)), paint(DARK));
  plate.position.set(-w * 0.25, h + 0.01, 0);
  g.add(plate, dome);
  return g;
};

const jug: Maker = (it, geo) => {
  const g = new THREE.Group();
  const { w, h } = it.size;
  const body = new THREE.Mesh(geo.get("jug", () => new THREE.CylinderGeometry(0.05, 0.065, 0.14, 16)), paint(STEEL, { metalness: 0.35, roughness: 0.45 }));
  body.position.set(-w * 0.25, h + 0.07, 0.02);
  g.add(body, cup(geo, -w * 0.05, 0.05, h, 0.9));
  return g;
};

const RULES: readonly (readonly [RegExp, Maker])[] = [
  [/espresso|coffee|make|machine|grinder/, espresso],
  [/sink|wash/, sink],
  [/fridge|refrigerator|milk|chiller/, fridge],
  [/order|till|register|pos|cashier/, till],
  [/pickup|pick-up|pass|collect/, bell],
  [/finish|garnish|lid|bar/, jug],
];

export function makeTopper(it: SceneItem, geo: GeometryCache): THREE.Object3D | null {
  if (it.role === "queue" || it.role === "ignore" || it.size.h < 0.3) return null;
  const nameHit = RULES.find(([re]) => re.test(it.name.toLowerCase()));
  const hit = nameHit ?? RULES.find(([re]) => re.test(it.category.toLowerCase()));
  return hit ? hit[1](it, geo) : null;
}
