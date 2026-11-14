/**
 * The operator's keyboard. One window listener; keys typed into a text field
 * (renaming a box) are left alone.
 */
import { keyAction, navigate, type KeyAction } from "../app/steps";
import { deleteComponent } from "../app/components";
import { costsOpen, workersOpen } from "./economics";
import { cancelSuggest, startSuggest } from "./suggest";
import { goTo, resetPlay, startOrReplay } from "./flow";
import { editKitchen, reveal } from "./kitchen-actions";
import { retrySave, skipToEnd, toggleFaster } from "./runs";
import { activeSetupId, workspaceReady, addNotice, dropNotice, importOpen, selectedId, sendCompare, session, view } from "./store";
import { openPanel } from "./panel-actions";

const HINT_MS = 3500;
let hintTimer: ReturnType<typeof setTimeout> | undefined;

/** A key that does nothing here says so, briefly, instead of failing silently. */
export function keyHint(text: string): void {
  addNotice({ id: "key-hint", text, tone: "calm" });
  if (hintTimer !== undefined) clearTimeout(hintTimer);
  hintTimer = setTimeout(() => dropNotice("key-hint"), HINT_MS);
}

/** Shift+F: the stage fills the screen (or leaves full screen). */
export function toggleFullscreen(): void {
  const doc = document;
  const done = doc.fullscreenElement ? doc.exitFullscreen() : doc.documentElement.requestFullscreen?.();
  void Promise.resolve(done).catch(() => keyHint("This browser did not allow full screen. Use its View menu, or press F11 / Ctrl+Cmd+F."));
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

function play(): void {
  const s = session.value;
  // Never restart a live run by accident: P does nothing while one is running.
  if (s && s.status === "running" && !s.replay && (view.value === "run" || view.value === "test")) {
    keyHint("A live run is going. Press E to end it first.");
    return;
  }
  switch (view.value) {
    case "scan":
      reveal();
      return;
    case "run":
    case "compare":
      sendCompare("replay");
      return;
    case "test":
      startOrReplay("second");
      return;
    default:
      keyHint("P replays scenarios in Run (step 3).");
      return;
  }
}

export function perform(action: KeyAction): void {
  if (workspaceReady.value && !activeSetupId.value && !["next", "back", "jump", "escape"].includes(action.type)) return;
  const here = view.value;
  switch (action.type) {
    case "delete": {
      const id = selectedId.value;
      if (here !== "play" || !id) return;
      cancelSuggest();
      editKitchen((k) => deleteComponent(k, id));
      selectedId.value = null;
      return;
    }
    case "next":
    case "back":
    case "jump": {
      const next = navigate(here, action);
      if (next === here && action.type !== "jump") keyHint(action.type === "next" ? "This is the last step." : "This is the first step.");
      goTo(next);
      if (action.type === "jump") openPanel();
      return;
    }
    case "play":
      play();
      return;
    case "faster":
      if (here === "compare" || here === "run") sendCompare("faster");
      else if (!toggleFaster()) keyHint(fasterWhyNot(here));
      return;
    case "skip":
      if (here === "compare" || here === "run") sendCompare("skip");
      else if (here !== "test") keyHint("E skips to the end in Run (step 3).");
      else if (!skipToEnd()) keyHint("No run is playing. Press P to start one.");
      return;
    case "escape":
      if (workersOpen.value) workersOpen.value = false;
      else if (costsOpen.value) costsOpen.value = false;
      else selectedId.value = null;
      return;
    case "reset":
      if (here === "play") resetPlay();
      else keyHint("Backspace undoes the change in Setup (step 1).");
      return;
    case "rehearsed":
      if (action.key === "m") return;
      if (here === "play") workersOpen.value = true;
      else keyHint("W opens Workers in Setup (step 1).");
      return;
    case "suggest":
      if (here === "play") startSuggest();
      else keyHint("A suggests changes in Setup (step 1).");
      return;
    case "costs":
      if (here !== "play") {
        goTo("play");
        openPanel();
        costsOpen.value = true;
      } else {
        openPanel();
        costsOpen.value = !costsOpen.value;
      }
      return;
    case "retry-save":
      if (!retrySave()) keyHint("Nothing is waiting to be saved.");
      return;
    default:
      return;
  }
}

function fasterWhyNot(here: string): string {
  if (here !== "run" && here !== "test") return "F plays faster in Original run, After the change, and Compare scenarios.";
  const s = session.value;
  if (s && !s.replay) return "A live run plays at real speed.";
  if (s?.status === "ended") return "The run is over. Press P to play it again.";
  return "No run is playing. Press P to start one.";
}

export function installKeys(): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (workersOpen.value || importOpen.value) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (isTyping(e.target)) {
      // Esc still closes the costs section from inside one of its fields; every other key is typing.
      if (e.key !== "Escape") return;
      (e.target as HTMLElement).blur();
    }
    if (e.shiftKey && (e.key === "F" || e.key === "f")) {
      e.preventDefault();
      toggleFullscreen();
      return;
    }
    const action = keyAction(e.key);
    if (!action) return;
    e.preventDefault();
    perform(action);
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}
