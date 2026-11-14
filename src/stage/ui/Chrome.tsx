/**
 * The frame around the kitchen: step strip, notices, key hint, inputs chip.
 */
import { STEPS, keyHints, stepIndex } from "../app/steps";
import { goTo } from "../state/flow";
import { nextRunIsLive } from "../state/runs";
import { drawerOpen, health, notices, presence, session, sources, step } from "../state/store";
import { Key } from "./bits";

export function StepStrip() {
  const here = stepIndex(step.value);
  return (
    <nav aria-label="Demo steps">
      <ol class="st-strip" data-testid="step-strip">
        {STEPS.map((s, i) => (
          <li key={s.id}>
            <button
              type="button"
              class={`st-step${i === here ? " here" : i < here ? " done" : ""}`}
              aria-current={i === here ? "step" : undefined}
              data-testid={`step-${s.id}`}
              onClick={() => goTo(s.id)}
            >
              <span class="n">{i + 1}</span>
              {s.name}
            </button>
          </li>
        ))}
      </ol>
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
  const here = step.value;
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

const LABEL = { scan: "Scan", taps: "Taps", positions: "Positions" } as const;

export function InputsChip() {
  const src = sources.value;
  const bad = new Set(health.value.filter((h) => h.state !== "ok").map((h) => h.input as string));
  const roles = presence.value;
  const keys = Object.keys(LABEL) as (keyof typeof LABEL)[];
  // All three the same: say it once ("Scan · Taps · Positions recorded"), so the chip stays on one line.
  const same = keys.every((k) => src[k] === src.scan) && bad.size === 0;
  const word = (k: keyof typeof LABEL) => (src[k] === "live" ? "live" : "recorded");
  const anyLive = keys.some((k) => src[k] === "live");
  return (
    <button type="button" class="st-inputs-chip" data-testid="btn-inputs" onClick={() => (drawerOpen.value = !drawerOpen.value)}>
      {keys.map((k) => (
        <span key={k} class={`st-src${src[k] === "live" ? " live" : ""}${bad.has(k) ? " bad" : ""}`} data-testid={`chip-source-${k}`} data-source={src[k]}>
          <i />
          {same ? LABEL[k] : `${LABEL[k]} ${word(k)}`}
        </span>
      ))}
      {same ? <span>{word("scan")}</span> : null}
      {anyLive ? (
        <span>
          {roles.tablet} tablet{roles.tablet === 1 ? "" : "s"}, {roles.camera} camera{roles.camera === 1 ? "" : "s"}
        </span>
      ) : null}
      <Key k="I" />
    </button>
  );
}
