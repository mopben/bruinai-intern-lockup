/**
 * The operator's keyboard. One window listener; keys typed into a text field
 * (renaming a box) are left alone.
 */
import { keyAction, navigate, type KeyAction } from "../app/steps";
import { applyRehearsed, closeCheck, goTo, openCheck, resetPlay, startOrReplay } from "./flow";
import { reveal } from "./kitchen-actions";
import { retrySave, skipToEnd, toggleFaster } from "./runs";
import { addNotice, checkOpen, drawerOpen, dropNotice, selectedId, sendCompare, session, step } from "./store";

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

/** True in Test while it shows the simulation, not the real-run check. */
function simulatedTest(): boolean {
  return step.value === "test" && !checkOpen.value;
}

/** True where a real run is on screen: Run, or the real-run check in Test. */
function realRun(): boolean {
  return step.value === "run" || (step.value === "test" && checkOpen.value);
}

function play(): void {
  const s = session.value;
  if (simulatedTest()) {
    sendCompare("replay");
    return;
  }
  // Never restart a live run by accident: P does nothing while one is running.
  if (s && s.status === "running" && !s.replay && realRun()) {
    keyHint("A live run is going. Press E to end it first.");
    return;
  }
  switch (step.value) {
    case "scan":
      reveal();
      return;
    case "run":
      startOrReplay("first");
      return;
    case "test":
      startOrReplay("second");
      return;
    default:
      keyHint("P plays a run in Run and Test.");
      return;
  }
}

export function perform(action: KeyAction): void {
  const here = step.value;
  switch (action.type) {
    case "next":
    case "back":
    case "jump": {
      const next = navigate(here, action);
      if (next === here && action.type !== "jump") keyHint(action.type === "next" ? "This is the last step." : "This is the first step.");
      goTo(next);
      return;
    }
    case "play":
      play();
      return;
    case "faster":
      if (simulatedTest()) sendCompare("faster");
      else if (!toggleFaster()) keyHint(fasterWhyNot(here));
      return;
    case "skip":
      if (simulatedTest()) sendCompare("skip");
      else if (!realRun()) keyHint("E skips to the end of a run in Run and Test.");
      else if (!skipToEnd()) keyHint("No run is playing. Press P to start one.");
      return;
    case "check":
      if (here !== "test") keyHint("C checks the prediction with a real run, in Test (step 5).");
      else if (checkOpen.value) closeCheck();
      else openCheck();
      return;
    case "inputs":
      drawerOpen.value = !drawerOpen.value;
      return;
    case "escape":
      if (drawerOpen.value) drawerOpen.value = false;
      else selectedId.value = null;
      return;
    case "reset":
      if (here === "play") resetPlay();
      else keyHint("Backspace undoes the change in Play (step 4).");
      return;
    case "rehearsed":
      if (here === "play") applyRehearsed(action.key);
      else keyHint("M and W make the rehearsed change in Play (step 4).");
      return;
    case "retry-save":
      if (!retrySave()) keyHint("Nothing is waiting to be saved.");
      return;
    default:
      return;
  }
}

function fasterWhyNot(here: string): string {
  if (here !== "run" && here !== "test") return "F plays a run faster in Run and Test.";
  const s = session.value;
  if (s && !s.replay) return "A live run plays at real speed.";
  if (s?.status === "ended") return "The run is over. Press P to play it again.";
  return "No run is playing. Press P to start one.";
}

export function installKeys(): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
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
