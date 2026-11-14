/**
 * The operator's keyboard. One window listener; keys typed into a text field
 * (renaming a box) are left alone.
 */
import { keyAction, navigate, type KeyAction } from "../app/steps";
import { applyRehearsed, beginFirstRun, beginTest, goTo, resetPlay } from "./flow";
import { reveal } from "./kitchen-actions";
import { retrySave, skipToEnd, startLive, toggleFaster } from "./runs";
import { drawerOpen, selectedId, sendCompare, session, step } from "./store";

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

function play(): void {
  const s = session.value;
  // Never restart a live run by accident: P does nothing while one is running.
  if (s && s.status === "running" && !s.replay) return;
  switch (step.value) {
    case "scan":
      reveal();
      return;
    case "run":
      if (s?.purpose === "first" && s.status === "idle") startLive();
      else beginFirstRun();
      return;
    case "test":
      if (s?.purpose === "second" && s.status === "idle") startLive();
      else void beginTest();
      return;
    case "compare":
      sendCompare("replay");
      return;
    default:
      return;
  }
}

export function perform(action: KeyAction): void {
  const here = step.value;
  switch (action.type) {
    case "next":
    case "back":
    case "jump":
      goTo(navigate(here, action));
      return;
    case "play":
      play();
      return;
    case "faster":
      if (here === "compare") sendCompare("faster");
      else toggleFaster();
      return;
    case "skip":
      if (here === "compare") sendCompare("skip");
      else if (here === "run" || here === "test") skipToEnd();
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
      return;
    case "rehearsed":
      if (here === "play") applyRehearsed(action.key);
      return;
    case "retry-save":
      retrySave();
      return;
    default:
      return;
  }
}

export function installKeys(): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
    const action = keyAction(e.key);
    if (!action) return;
    e.preventDefault();
    perform(action);
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}
