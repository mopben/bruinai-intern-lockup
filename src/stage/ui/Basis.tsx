/**
 * Small plain lines that say where the numbers come from and how far to trust
 * them. Extrapolation is read defensively: shown when present, skipped when not.
 */
import type { Prediction } from "../../core";
import { usableFirstRun } from "../state/derive";

/** "Numbers from the recorded run: Original counter." Always on Edit and After the change. */
export function NumbersBasis() {
  const run = usableFirstRun.value;
  if (!run) return null;
  const text =
    run.origin === "recorded"
      ? `Numbers from the recorded run: ${run.title ?? run.label}.`
      : run.replaced.length > 0
        ? `Numbers from the live run, with the ${run.replaced.join(" and ")} partly from the recording.`
        : "Numbers from the run just made in this room.";
  return (
    <p class="st-basis" data-testid="numbers-basis">
      {text}
    </p>
  );
}

/** The model's note when a layout is outside what the first run measured, if the core gives one. */
export function ExtrapolationNote(props: { readonly prediction: Prediction | null }) {
  const p = props.prediction as (Prediction & { readonly extrapolation?: { readonly outside?: boolean; readonly note?: string } }) | null;
  const e = p?.extrapolation;
  if (!e || !e.outside || !e.note) return null;
  return (
    <p class="st-aside" data-testid="extrapolation">
      {e.note}
    </p>
  );
}
