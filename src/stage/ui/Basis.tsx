/**
 * Small plain lines that say where the numbers come from and how far to trust
 * them. Fields the core may add later (trust baseline, walking check, scope,
 * extrapolation) are read defensively: shown when present, skipped when not.
 */
import { formatPercent, type Prediction, type TrustResult } from "../../core";
import { usableFirstRun } from "../state/derive";

/** "Numbers from the recorded run: Original counter." Always on Trust, Play and Test. */
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

/** A caveat when the first run was not all live. */
export function PartlyRecorded() {
  const run = usableFirstRun.value;
  if (!run || run.origin !== "live" || run.replaced.length === 0) return null;
  return (
    <p class="st-warn" data-testid="partly-recorded">
      The {run.replaced.join(" and ")} came partly from the recording, not only from this room, so this check mixes the two.
    </p>
  );
}

type Extra = {
  readonly baselineErrorPct?: number | null;
  readonly walkCheck?: Record<string, unknown> | null;
  readonly scope?: string;
};

const num = (o: Record<string, unknown>, ...keys: string[]): number | null => {
  for (const k of keys) if (typeof o[k] === "number" && Number.isFinite(o[k])) return o[k] as number;
  return null;
};
const str = (o: Record<string, unknown>, ...keys: string[]): string | null => {
  for (const k of keys) if (typeof o[k] === "string" && o[k]) return o[k] as string;
  return null;
};

function walkLine(w: Record<string, unknown>): string | null {
  const reason = str(w, "reason", "message", "note");
  const secs = num(w, "meanAbsErrorS", "meanAbsS", "maeS", "meanAbsSeconds");
  const pct = num(w, "errorPct", "meanAbsPct", "pct", "percent");
  const trips = num(w, "trips", "tripCount", "n", "count");
  if (secs === null && pct === null) return reason ? `Walking times: ${reason}` : null;
  const parts = [secs !== null ? `${secs.toFixed(1)} s` : null, pct !== null ? formatPercent(pct) : null].filter(Boolean).join(", ");
  return `Walking times, each trip predicted from the others: off by ${parts} on average${trips !== null ? ` (${trips} trips)` : ""}.`;
}

/** Under the big trust number: a trivial guess for scale, the walking check, and what the check covers. */
export function TrustExtras(props: { readonly result: TrustResult }) {
  const x = props.result as TrustResult & Extra;
  const lines: string[] = [];
  if (typeof x.baselineErrorPct === "number" && Number.isFinite(x.baselineErrorPct))
    lines.push(`For scale: guessing every order takes the average time would be off by ${formatPercent(Math.abs(x.baselineErrorPct))}.`);
  if (x.walkCheck === null && "walkCheck" in x) lines.push("Walking times could not be checked on this run.");
  if (x.walkCheck && typeof x.walkCheck === "object") {
    const line = walkLine(x.walkCheck);
    if (line) lines.push(line);
  }
  if (typeof x.scope === "string" && x.scope) lines.push(x.scope);
  if (lines.length === 0) return null;
  return (
    <div class="st-extras" data-testid="trust-extras">
      {lines.map((l) => (
        <p key={l} class="st-small">
          {l}
        </p>
      ))}
    </div>
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
