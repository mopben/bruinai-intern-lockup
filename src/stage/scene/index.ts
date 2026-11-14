/**
 * Dry Run kitchen scene: the toy-city 3D model. Imperative three.js, no
 * framework. Mount it into any sized element; several can share a page.
 *
 * Usage
 * ```ts
 * import "../theme";                       // fonts + CSS variables, once per page
 * import { createKitchenScene } from "./scene";
 *
 * const scene = createKitchenScene(el, {
 *   onLayoutChange: (layout) => recompute(layout), // every pointer move of a drag
 *   onLayoutCommit: (layout) => save(layout),      // once, on release
 *   onSelect: (boxId) => openPanel(boxId),
 * });
 * scene.setKitchen({ scan, setup, layout });       // call again whenever any of them changes
 * await scene.playReveal();                        // boxes pop up with scanner labels
 * await scene.showNames();                         // fade to the owner's names and paint
 * scene.setEditable(true);
 * // every frame while a run plays:
 * scene.setWorkers([{ id, color, x, z, carrying }]);
 * scene.setQueues({ [stationId]: waiting, [pickupId]: ready });
 * scene.setPaths([{ points, kind: "walk", label: "6.4 m" }]);
 * scene.setGhost(originalLayout);                  // faint outlines where things were
 * scene.dispose();
 * ```
 *
 * Contract notes
 * - Floor frame as in core/types.ts: metres, x right, z toward the viewer.
 * - The scene never mutates inputs. During a drag it emits a new Layout on
 *   every move; it also shows that position itself, so echoing the layout back
 *   through setKitchen is cheap but not required.
 * - Items with role "ignore" are hidden (shown only in scan-label mode).
 * - Locked items cannot be dragged; trying shakes them and shows "Fixed: ...".
 * - setWorkers / setQueues / setPaths are cheap; call them per frame.
 * - The camera is fixed unless `allowOrbit` is set. Rendering is on demand.
 */
export { createKitchenScene } from "./kitchen-scene";
export type {
  KitchenInput,
  KitchenSceneHandle,
  KitchenSceneOptions,
  LabelMode,
  PathInput,
  SceneDebug,
  WorkerInput,
} from "./api";
export { sampleKitchen, sampleScan, sampleSetup, sampleLayout, SAMPLE_IDS } from "./sample-kitchen";
