/**
 * The main kitchen scene (steps 1 to 5). Created by the SceneHost component;
 * controllers reach it here. All calls are no-ops before it exists.
 */
import type { KitchenSceneHandle } from "../scene";

let handle: KitchenSceneHandle | null = null;
const waiting = new Set<(h: KitchenSceneHandle) => void>();

export function setMainScene(h: KitchenSceneHandle | null): void {
  handle = h;
  if (h) {
    const pending = [...waiting];
    waiting.clear();
    pending.forEach((fn) => fn(h));
  }
}

export function mainScene(): KitchenSceneHandle | null {
  return handle;
}

/** Runs `fn` with the scene now, or as soon as it exists. */
export function withScene(fn: (h: KitchenSceneHandle) => void): void {
  if (handle) fn(handle);
  else waiting.add(fn);
}

/** Other live scenes (the two Compare halves), by name. Read only by the test hook. */
const others = new Map<string, KitchenSceneHandle>();

export function registerScene(name: string, h: KitchenSceneHandle | null): void {
  if (h) others.set(name, h);
  else others.delete(name);
}

export function namedScenes(): ReadonlyMap<string, KitchenSceneHandle> {
  return others;
}
