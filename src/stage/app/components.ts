import type { BoxSize, ItemRole, Layout, Vec2 } from "../../core";
import type { Kitchen } from "./kitchen-edit";
import { blocks, dragArea, footprintRect, resolveItems, resolveWalls } from "../scene/model";
import { CONTACT_GAP_M, overlaps } from "../scene/collision";

export const COMPONENTS: readonly { id: string; name: string; role: ItemRole; category: string; size: BoxSize }[] = [
  { id: "espresso", name: "Espresso machine", role: "station", category: "storage", size: { w: .8, h: 1.1, d: .6 } },
  { id: "counter", name: "Prep counter", role: "station", category: "table", size: { w: .8, h: .9, d: .6 } },
  { id: "till", name: "Order till", role: "station", category: "table", size: { w: .6, h: .9, d: .6 } },
  { id: "fridge", name: "Fridge", role: "storage", category: "refrigerator", size: { w: .6, h: 1.2, d: .6 } },
  { id: "shelf", name: "Ingredient shelf", role: "storage", category: "storage", size: { w: .8, h: 1.2, d: .4 } },
  { id: "sink", name: "Sink", role: "fixture", category: "sink", size: { w: .6, h: .9, d: .6 } },
];

export function addComponent(k: Kitchen, componentId: string, point: Vec2, collisionLayout: Layout = k.layout): { kitchen: Kitchen; id: string } | null {
  const component = COMPONENTS.find((c) => c.id === componentId);
  if (!component || !Number.isFinite(point.x) || !Number.isFinite(point.z)) return null;
  const x = Math.floor(point.x) + .5;
  const z = Math.floor(point.z) + .5;
  const rect = footprintRect(component.size, x, z, 0);
  const room = dragArea(k);
  if (rect.minX < room.minX || rect.maxX > room.maxX || rect.minZ < room.minZ || rect.maxZ > room.maxZ) return null;
  const occupied = resolveItems({ ...k, layout: collisionLayout }).filter(blocks);
  if (occupied.some((item) => overlaps(rect, footprintRect(item.size, item.x, item.z, item.yaw), CONTACT_GAP_M))) return null;
  if (resolveWalls(k.scan).some((wall) => overlaps(rect, footprintRect({ w: wall.length, h: 0, d: wall.thickness }, wall.x, wall.z, wall.yaw), CONTACT_GAP_M))) return null;
  let n = 1;
  while (k.scan.boxes.some((b) => b.id === `component-${n}`)) n++;
  const id = `component-${n}`;
  return { id, kitchen: {
    scan: { ...k.scan, boxes: [...k.scan.boxes, { id, category: component.category, center: { x, y: component.size.h / 2, z }, size: { ...component.size }, yaw: 0 }] },
    setup: { ...k.setup, items: [...k.setup.items, { boxId: id, name: component.name, role: component.role, locked: false, standSide: "front" }] },
    layout: { ...k.layout, placements: { ...k.layout.placements, [id]: { x, z, yaw: 0 } } },
  } };
}
