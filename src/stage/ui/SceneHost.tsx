/**
 * The main kitchen scene and how each view uses it: what
 * layout it shows, who stands where, the walking paths, the ghost, dragging.
 */
import { computed, effect } from "@preact/signals";
import { useEffect, useRef, useState } from "preact/hooks";
import { formatMetres, type Layout } from "../../core";
import type { WalkLeg } from "../../core";
import { standingWorkers } from "../app/playback";
import { tryWorld } from "../app/numbers";
import { originalLayout, playNumbers } from "../state/derive";
import { editKitchen } from "../state/kitchen-actions";
import { currentPlayer } from "../state/runs";
import { mainScene, setMainScene } from "../state/scene-ref";
import { kitchen, moveInScan, playLayout, scanState, selectedId, session, view, testPlan } from "../state/store";
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
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const scene = createKitchenScene(el, {
      initialLabels: "scan",
      cameraControls: true,
      onCameraChange: setMoved,
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
      {moved && (
        <button type="button" class="st-chip st-reset-view" data-testid="reset-view" onClick={() => mainScene()?.reframe()}>
          Reset view
        </button>
      )}
    </div>
  );
}

export { mainScene };
