/**
 * The main kitchen scene and how each view uses it: what
 * layout it shows, who stands where, the walking paths, the ghost, dragging.
 */
import { computed, effect } from "@preact/signals";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { formatMetres, type Layout } from "../../core";
import type { WalkLeg } from "../../core";
import { addComponent, COMPONENTS } from "../app/components";
import { roomBounds } from "../scene/model";
import { openPanel } from "../state/panel-actions";
import { standingWorkers } from "../app/playback";
import { tryWorld } from "../app/numbers";
import { originalLayout, playNumbers } from "../state/derive";
import { editKitchen } from "../state/kitchen-actions";
import { currentPlayer } from "../state/runs";
import { mainScene, setMainScene } from "../state/scene-ref";
import { addNotice, kitchen, moveInScan, playLayout, scanState, selectedId, session, view, testPlan } from "../state/store";
import { createKitchenScene, type KitchenSceneHandle, type PathInput } from "../scene";

/** The layout each step shows. */
function shownLayout(): Layout | null {
  const k = kitchen.value;
  if (!k) return null;
  switch (view.value) {
    case "play":
      return playLayout.value ?? k.layout;
    case "test":
    case "compare": {
      const plan = testPlan.value;
      return plan && plan.judgeLayout === playLayout.value ? plan.layout : playLayout.value ?? k.layout;
    }
    default:
      return originalLayout.value ?? k.layout;
  }
}

function pathsFrom(legs: readonly WalkLeg[]): readonly PathInput[] {
  return legs.map((l) => ({ points: l.path, kind: l.kind, label: formatMetres(l.roundTripM) }));
}

/** True while the step on screen shows a run that has started (the player draws then). */
const drawingRun = computed(() => {
  const s = view.value;
  const sess = session.value;
  if (!sess || sess.status === "idle") return false;
  return (s === "run" && sess.purpose === "first") || (s === "test" && sess.purpose === "second");
});

function syncScene(scene: KitchenSceneHandle): () => void {
  const offs = [
    effect(() => {
      const k = kitchen.value;
      const layout = shownLayout();
      // During the reveal the reveal itself sets the kitchen; afterwards keep it in step.
      if (!k || !layout || scanState.value === "revealing") return;
      scene.setKitchen({ scan: k.scan, setup: k.setup, layout });
    }),
    effect(() => {
      const s = view.value;
      scene.setEditable(s === "play" || (s === "scan" && moveInScan.value));
      scene.setSelected(s === "play" ? selectedId.value : null);
      scene.setGhost(s === "play" || s === "test" ? originalLayout.value : null);
    }),
    effect(() => {
      const n = playNumbers.value;
      if (view.value !== "play" || !n) {
        scene.setPaths([]);
        return;
      }
      scene.setPaths(n.walking.ok ? pathsFrom(n.walking.value.legs) : []);
    }),
    effect(() => {
      // Who stands where when no run is being drawn.
      const s = view.value;
      const k = kitchen.value;
      const layout = shownLayout();
      if (!k || !layout) return;
      if (drawingRun.value) {
        // Outside this effect: a redraw publishes the session.
        queueMicrotask(() => currentPlayer()?.redraw());
        return;
      }
      scene.setQueues({});
      if (s === "scan") {
        scene.setWorkers([]);
        return;
      }
      const world = s === "play" ? playNumbers.value?.world ?? null : (() => {
        const w = tryWorld(k.scan, k.setup, layout);
        return w.ok ? w.value : null;
      })();
      scene.setWorkers(world ? standingWorkers(world) : []);
    }),
  ];
  return () => offs.forEach((off) => off());
}

export function SceneHost(props: { readonly hidden: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [moved, setMoved] = useState(false);
  const [menu, setMenu] = useState<{ x: number; z: number; left: number; top: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const here = view.value;
  useEffect(() => setMenu(null), [here]);
  useLayoutEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (e: PointerEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(null); };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); setMenu(null); } };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", escape, true);
    return () => { document.removeEventListener("pointerdown", outside); window.removeEventListener("keydown", escape, true); };
  }, [menu]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const scene = createKitchenScene(el, {
      initialLabels: "scan",
      cameraControls: true,
      onCameraChange: setMoved,
      onFloorContextMenu: (point, client) => {
        const k = kitchen.value;
        if (view.value !== "play" || !k) return;
        const room = roomBounds(k);
        if (point.x < room.minX || point.x > room.maxX || point.z < room.minZ || point.z > room.maxZ) return;
        setMenu({ ...point, left: Math.max(8, Math.min(client.x, window.innerWidth - 246)), top: Math.max(8, Math.min(client.y, window.innerHeight - 352)) });
      },
      onLayoutChange: (layout) => {
        if (view.value === "play") playLayout.value = layout;
      },
      onLayoutCommit: (layout) => {
        if (view.value === "scan") editKitchen((k) => ({ ...k, layout }));
        if (view.value === "play") playLayout.value = layout;
      },
      onSelect: (id) => {
        if (view.value === "play") selectedId.value = id;
      },
    });
    setMainScene(scene);
    const stop = syncScene(scene);
    return () => {
      stop();
      setMainScene(null);
      scene.dispose();
    };
  }, []);
  const k = kitchen.value;
  return (
    <div ref={ref} class={`st-scene${props.hidden || !k ? " dim" : ""}`} data-testid="kitchen-scene">
      {menu && here === "play" ? <div ref={menuRef} class="st-component-menu" role="menu" aria-label="Add a component" style={{ left: `${menu.left}px`, top: `${menu.top}px` }} onContextMenu={(e) => e.preventDefault()} onKeyDown={(e) => {
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
        e.preventDefault(); e.stopPropagation();
        const buttons = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[(index + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
      }}>
        <strong>Add a component</strong>
        {COMPONENTS.map((component) => <button type="button" role="menuitem" key={component.id} onClick={() => {
          let added: string | null = null;
          editKitchen((current) => {
            const result = addComponent(current, component.id, menu, playLayout.value ?? current.layout);
            if (!result) return current;
            added = result.id;
            return result.kitchen;
          });
          setMenu(null);
          if (added) { selectedId.value = added; openPanel(); }
          else addNotice({ id: "component-space", text: "This component needs more room. Right-click a clear square inside the kitchen.", tone: "warn" });
        }}>{component.name}</button>)}
      </div> : null}
      {moved && (
        <button type="button" class="st-chip st-reset-view" data-testid="reset-view" onClick={() => mainScene()?.reframe()}>
          Reset view
        </button>
      )}
    </div>
  );
}

export { mainScene };
