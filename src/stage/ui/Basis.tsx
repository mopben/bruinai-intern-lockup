/**
 * The model's note when a layout is outside what the first run measured.
 * Read defensively: shown when present, skipped when not.
 */
import type { Prediction } from "../../core";

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
