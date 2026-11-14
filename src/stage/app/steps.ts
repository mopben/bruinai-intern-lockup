/**
 * The five demo steps and the operator's keyboard map. Pure: no DOM.
 */

export const STEPS = [
  { id: "scan", name: "Scan" },
  { id: "run", name: "Run" },
  { id: "trust", name: "Trust" },
  { id: "play", name: "Play" },
  { id: "test", name: "Test" },
] as const;

export type StepId = (typeof STEPS)[number]["id"];
export const STEP_IDS: readonly StepId[] = STEPS.map((s) => s.id);

export function stepIndex(id: StepId): number {
  return STEP_IDS.indexOf(id);
}

export function stepAt(index: number): StepId {
  const i = Math.min(STEP_IDS.length - 1, Math.max(0, Math.floor(index)));
  return STEP_IDS[i] as StepId;
}

/** What a key press means. Step-specific actions are interpreted by the step itself. */
export type KeyAction =
  | { readonly type: "next" }
  | { readonly type: "back" }
  | { readonly type: "jump"; readonly step: StepId }
  | { readonly type: "play" }
  | { readonly type: "faster" }
  | { readonly type: "skip" }
  | { readonly type: "inputs" }
  /** Test: open the real-run check, or go back to the simulation. */
  | { readonly type: "check" }
  | { readonly type: "escape" }
  | { readonly type: "reset" }
  | { readonly type: "rehearsed"; readonly key: "m" | "w" }
  | { readonly type: "retry-save" };

/** Maps a KeyboardEvent.key (with no modifiers) to an action, or null. */
export function keyAction(key: string): KeyAction | null {
  switch (key) {
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
    case "i":
    case "I":
      return { type: "inputs" };
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
    case "c":
    case "C":
      return { type: "check" };
    default: {
      const n = Number(key);
      if (key.length === 1 && Number.isInteger(n) && n >= 1 && n <= STEP_IDS.length) return { type: "jump", step: stepAt(n - 1) };
      return null;
    }
  }
}

/** The step after a navigation action, or the same step for anything else. */
export function navigate(current: StepId, action: KeyAction): StepId {
  const i = stepIndex(current);
  if (action.type === "next") return stepAt(i + 1);
  if (action.type === "back") return stepAt(i - 1);
  if (action.type === "jump") return action.step;
  return current;
}

/**
 * The quiet key hint for each step: only the keys that do something there.
 * `check`: Test is showing the real-run check, not the simulation.
 */
export function keyHints(step: StepId, live: boolean, check = false): readonly { readonly keys: string; readonly does: string }[] {
  const nav = [
    { keys: "→", does: "next" },
    { keys: "←", does: "back" },
  ];
  const common = [{ keys: "I", does: "inputs" }];
  const run = live
    ? [...nav, { keys: "P", does: "start" }, { keys: "E", does: "end run" }]
    : [...nav, { keys: "P", does: "play again" }, { keys: "F", does: "faster" }, { keys: "E", does: "skip to end" }];
  switch (step) {
    case "scan":
      return [...nav, { keys: "P", does: "replay the scan" }, ...common, { keys: "⇧F", does: "full screen" }];
    case "run":
      return [...run, ...common];
    case "test":
      return check
        ? [...run, { keys: "C", does: "back to the simulation" }, ...common]
        : [{ keys: "←", does: "back" }, { keys: "P", does: "play again" }, { keys: "F", does: "faster" }, { keys: "C", does: "check with a real run" }, ...common];
    case "trust":
      return [...nav, ...common];
    case "play":
      return [...nav, { keys: "M", does: "rehearsed move" }, { keys: "W", does: "rehearsed worker" }, { keys: "⌫", does: "reset" }, ...common];
    default:
      return nav;
  }
}
