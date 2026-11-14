/**
 * The three demo steps, their views and the operator's keyboard map. Pure: no DOM.
 */

export const STEPS = [
  { id: "build", name: "Setup", views: ["play", "scan"] },
  { id: "orders", name: "Orders", views: ["orders"] },
  { id: "results", name: "Run", views: ["compare", "run", "test"] },
] as const;

export type StepId = (typeof STEPS)[number]["id"];
export type ViewId = (typeof STEPS)[number]["views"][number];
export const STEP_IDS: readonly StepId[] = STEPS.map((s) => s.id);
export const VIEW_ORDER: readonly ViewId[] = ["play", "orders", "compare", "run", "test"];

export function stepOf(view: ViewId): StepId {
  return STEPS.find((s) => (s.views as readonly ViewId[]).includes(view))!.id;
}

export function defaultView(step: StepId): ViewId {
  return STEPS.find((s) => s.id === step)!.views[0];
}

export function stepIndex(id: StepId): number {
  return STEP_IDS.indexOf(id);
}

export function stepAt(index: number): StepId {
  const i = Math.min(STEP_IDS.length - 1, Math.max(0, Math.floor(index)));
  return STEP_IDS[i] as StepId;
}

export function viewAt(index: number): ViewId {
  const i = Math.min(VIEW_ORDER.length - 1, Math.max(0, Math.floor(index)));
  return VIEW_ORDER[i] as ViewId;
}

/** What a key press means. Step-specific actions are interpreted by the step itself. */
export type KeyAction =
  | { readonly type: "delete" }
  | { readonly type: "next" }
  | { readonly type: "back" }
  | { readonly type: "jump"; readonly step: StepId }
  | { readonly type: "play" }
  | { readonly type: "faster" }
  | { readonly type: "skip" }
  | { readonly type: "escape" }
  | { readonly type: "reset" }
  | { readonly type: "rehearsed"; readonly key: "m" | "w" }
  | { readonly type: "optimize" }
  | { readonly type: "costs" }
  | { readonly type: "retry-save" };

/** Maps a KeyboardEvent.key (with no modifiers) to an action, or null. */
export function keyAction(key: string): KeyAction | null {
  switch (key) {
    case "Delete":
      return { type: "delete" };
    case "ArrowRight":
    case " ":
    case "PageDown":
      return { type: "next" };
    case "ArrowLeft":
    case "PageUp":
      return { type: "back" };
    case "p":
    case "P":
      return { type: "play" };
    case "f":
    case "F":
      return { type: "faster" };
    case "e":
    case "E":
      return { type: "skip" };
    case "Escape":
      return { type: "escape" };
    case "Backspace":
      return { type: "reset" };
    case "m":
    case "M":
      return { type: "rehearsed", key: "m" };
    case "w":
    case "W":
      return { type: "rehearsed", key: "w" };
    case "s":
    case "S":
      return { type: "retry-save" };
    case "a":
    case "A":
      return { type: "optimize" };
    case "c":
    case "C":
      return { type: "costs" };
    default: {
      const n = Number(key);
      if (key.length === 1 && Number.isInteger(n) && n >= 1 && n <= STEP_IDS.length) return { type: "jump", step: stepAt(n - 1) };
      return null;
    }
  }
}

/** The view after a navigation action, or the same view for anything else. */
export function navigate(current: ViewId, action: KeyAction): ViewId {
  const i = VIEW_ORDER.indexOf(current === "scan" ? "play" : current);
  if (action.type === "next") return viewAt(i + 1);
  if (action.type === "back") return viewAt(i - 1);
  if (action.type === "jump") return defaultView(action.step);
  return current;
}

/** The quiet key hint for each step: only the keys that do something there. */
export function keyHints(view: ViewId, live: boolean): readonly { readonly keys: string; readonly does: string }[] {
  const nav = [
    { keys: "→", does: "next" },
    { keys: "←", does: "back" },
  ];
  switch (view) {
    case "scan":
      return [...nav, { keys: "P", does: "replay the scan" }, { keys: "⇧F", does: "full screen" }];
    case "run":
    case "test":
      return live
        ? [...nav, { keys: "P", does: `start ${view === "run" ? "Original run" : "After the change"}` }, { keys: "E", does: "end run" }]
        : [...nav, { keys: "P", does: `replay ${view === "run" ? "Original run" : "After the change"}` }, { keys: "F", does: "faster" }, { keys: "E", does: "skip to end" }];
    case "play":
      return [
        ...nav,
        { keys: "Del", does: "delete selected component" },
        { keys: "W", does: "workers" },
        { keys: "A", does: "optimize" },
        { keys: "C", does: "costs" },
        { keys: "⌫", does: "reset" },
      ];
    case "compare":
      return [...nav, { keys: "P", does: "replay scenarios" }, { keys: "F", does: "faster" }, { keys: "E", does: "skip to end" }];
    default:
      return nav;
  }
}
