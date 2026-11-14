/**
 * Public types of the kitchen scene. Re-exported from ./index.ts.
 */
import type { Layout, Scan, Setup, Vec2 } from "../../core/types";

export interface KitchenInput {
  readonly scan: Scan;
  /** Owner's names and roles. Without it boxes show scan categories in neutral paint. */
  readonly setup?: Setup | null;
  /** Placements and workers. Without it boxes sit where the scan put them. */
  readonly layout?: Layout | null;
}

/** One worker on screen this frame. Positions are floor metres in the scan frame. */
export interface WorkerInput {
  readonly id: string;
  /** Hat colour #rrggbb (WorkerDef.color). */
  readonly color: string;
  readonly x: number;
  readonly z: number;
  /** Draw a cup in the pawn's hands. */
  readonly carrying?: boolean;
}

/** A walking route drawn on the floor as a dashed line. */
export interface PathInput {
  readonly points: readonly Vec2[];
  /** "walk" (default caramel), "fetch" (lavender), "carry" (jade). */
  readonly kind?: string;
  /** Optional text shown at the middle of the path, e.g. "6.4 m". */
  readonly label?: string;
}

export type LabelMode = "names" | "scan";

export interface KitchenSceneOptions {
  /** Called continuously while an item is dragged, with a new Layout each time. */
  readonly onLayoutChange?: (next: Layout) => void;
  /** Called once when a drag (or rotate) ends, with the final Layout. */
  readonly onLayoutCommit?: (next: Layout) => void;
  /** Called on a click: the box id, or null for empty floor. */
  readonly onSelect?: (boxId: string | null) => void;
  /** Let the operator orbit (drag empty floor) and zoom (wheel). Default false. */
  readonly allowOrbit?: boolean;
  /** Start with scan labels and raw paint (before a reveal). Default "names". */
  readonly initialLabels?: LabelMode;
  /** Override the "Fixed: power" hint for a locked item. */
  readonly lockHint?: (item: { readonly id: string; readonly name: string; readonly category: string }) => string;
  /**
   * Camera angles (radians). Default: azimuth 0.42, elevation 0.86. A more
   * frontal, higher view (smaller azimuth, larger elevation) is less wide and
   * fills a tall half-screen better in side-by-side.
   */
  readonly view?: { readonly azimuth: number; readonly elevation: number };
  /** Allow rotating the held or selected item by 90 degrees (R key, double-click). Default true. */
  readonly allowRotate?: boolean;
  /** Put spare height above the room instead of around it (side-by-side halves sit on their numbers). Default "center". */
  readonly alignV?: "center" | "bottom";
  /** Areas (CSS px inside the container) name tags must not cover, e.g. a "Before" label. Read every frame. */
  readonly labelKeepOut?: () => readonly { readonly l: number; readonly r: number; readonly t: number; readonly b: number }[];
}

export interface KitchenSceneHandle {
  /** Build or update the model. Diffed: moving one item does not rebuild the others. */
  setKitchen(input: KitchenInput): void;
  /** Boxes pop up one after another with scanner labels. Resolves when done (~2.5 s). */
  playReveal(): Promise<void>;
  /** Cross-fade from scanner labels to the owner's names and paint. Resolves when done. */
  showNames(): Promise<void>;
  /** Switch back to scanner labels and raw paint (no animation). */
  showScanLabels(): void;
  /** Turn drag-to-move on or off. */
  setEditable(on: boolean): void;
  /** Highlight one item, or none. */
  setSelected(boxId: string | null): void;
  /** Called every frame by the app. Workers not listed shrink away; new ones pop in. */
  setWorkers(workers: readonly WorkerInput[]): void;
  /** Order tickets waiting at each box (station or pickup), keyed by boxId. Missing keys mean 0. */
  setQueues(counts: Readonly<Record<string, number>>): void;
  /** Dashed walking routes on the floor. Pass [] to clear. */
  setPaths(paths: readonly PathInput[]): void;
  /** Faint outlines where items were in `layout`, for items that have moved since. null clears. */
  setGhost(layout: Layout | null): void;
  /** Screen position (CSS px within the container) of a floor point, for anchoring panels. */
  projectToScreen(x: number, y: number, z: number): { x: number; y: number } | null;
  /** Re-fit the camera on the room (after an orbit, say). */
  reframe(): void;
  /** Stop rendering and free GPU memory, listeners and DOM. */
  dispose(): void;
  /**
   * TEST HOOK, read-only: what the scene holds now, for the acceptance test
   * (e2e/). Never used for display.
   */
  debug(): SceneDebug;
}

/** TEST HOOK: a read-only snapshot of one scene (see KitchenSceneHandle.debug). */
export interface SceneDebug {
  readonly items: readonly { readonly id: string; readonly name: string; readonly role: string; readonly locked: boolean; readonly x: number; readonly z: number; readonly h: number }[];
  /** Tickets per box id, as last set. */
  readonly queues: Readonly<Record<string, number>>;
  /** Box ids whose pile shows the bottleneck alert now. */
  readonly alerts: readonly string[];
  readonly workers: readonly { readonly id: string; readonly x: number; readonly z: number }[];
  /** Frames actually drawn, and when the last one was (performance.now() ms). */
  readonly renders: number;
  readonly lastRenderAt: number;
  /** Times the WebGL context was lost and restored. */
  readonly contextLost: number;
  readonly contextRestored: number;
  /** CSS size of the scene and the canvas's drawing-buffer size. */
  readonly width: number;
  readonly height: number;
  readonly bufferWidth: number;
  readonly bufferHeight: number;
  /** Viewport (client) position of the top centre of a box, for pointer tests. */
  readonly screen: Readonly<Record<string, { readonly x: number; readonly y: number }>>;
}
