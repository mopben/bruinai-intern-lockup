/**
 * The frame around the kitchen: the activity bar, the panel's resize sash,
 * notices and the key hint. The results view switch lives in the Run panel.
 */
import type { TargetedPointerEvent } from "preact";
import { STEPS, keyHints, stepIndex } from "../app/steps";
import { goTo } from "../state/flow";
import { activate, beginDrag, endDrag, resetPanelWidth, setPanelWidth } from "../state/panel-actions";
import { nextRunIsLive } from "../state/runs";
import { currentStep, notices, session, view } from "../state/store";
import { Key } from "./bits";
import { BuildIcon, OrdersIcon, RunIcon } from "./icons";

const ICONS = [BuildIcon, OrdersIcon, RunIcon] as const;

export function ActivityBar() {
  const here = stepIndex(currentStep.value);
  return (
    <nav class="st-activity" aria-label="Demo steps">
      <ol data-testid="step-strip">
        {STEPS.map((s, i) => {
          const Icon = ICONS[i]!;
          return (
            <li key={s.id}>
              <button
                type="button"
                class={`st-act${i === here ? " here" : ""}`}
                aria-current={i === here ? "step" : undefined}
                aria-expanded={i === here ? "true" : undefined}
                aria-label={`${i + 1}: ${s.name}`}
                title={`${s.name} (${i + 1})`}
                data-testid={`step-${s.id}`}
                onClick={() => activate(s.id)}
              >
                <span class="n">{i + 1}</span>
                <Icon />
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function Sash() {
  const onDown = (e: TargetedPointerEvent<HTMLElement>) => {
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startW = document.querySelector<HTMLElement>(".st-panel")?.offsetWidth ?? 0;
    beginDrag();
    el.closest(".st-root")?.classList.add("resizing");
    const move = (ev: PointerEvent) => setPanelWidth(startW + ev.clientX - startX);
    const up = (ev: PointerEvent) => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.closest(".st-root")?.classList.remove("resizing");
      endDrag(startW + ev.clientX - startX);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };
  return <div class="st-sash" role="separator" aria-orientation="vertical" aria-label="Resize the panel" onPointerDown={onDown} onDblClick={resetPanelWidth} />;
}

export function ResultsSwitch() {
  if (currentStep.value !== "results") return null;
  const choices = [
    { id: "compare", label: "Compare scenarios" },
    { id: "run", label: "Run scenario" },
    { id: "filmed", label: "Filmed run" },
  ] as const;
  return (
    <nav class="st-results-switch" aria-label="Results views">
      {choices.map((choice) => (
        <button type="button" class={`st-step${view.value === choice.id ? " here" : ""}`} aria-current={view.value === choice.id ? "page" : undefined} data-testid={`view-${choice.id}`} onClick={() => goTo(choice.id)} key={choice.id}>
          {choice.label}
        </button>
      ))}
    </nav>
  );
}

export function Notices() {
  const list = notices.value;
  if (list.length === 0) return null;
  return (
    <div class="st-notices" role="status">
      {list.map((n) => (
        <span key={n.id} class={`st-chip ${n.tone}`} data-testid="notice">
          <span class="dot" />
          {n.text}
        </span>
      ))}
    </div>
  );
}

export function KeyHints() {
  const s = session.value;
  const here = view.value;
  const mine = s && ((here === "run" && s.purpose === "first") || (here === "test" && s.purpose === "second")) ? s : null;
  const hints = keyHints(here, mine ? !mine.replay : nextRunIsLive());
  return (
    <div class="st-hints" aria-label="Keys">
      {hints.map((h) => (
        <span key={h.keys}>
          <Key k={h.keys} />
          {h.does}
        </span>
      ))}
    </div>
  );
}
