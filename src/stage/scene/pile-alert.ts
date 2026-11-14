/**
 * Which station glows as the bottleneck. Relative, not absolute: a station
 * glows only when its pile is clearly the largest, so balanced queues never
 * glow and no threshold is tuned to one kitchen. Hysteresis keeps the glow
 * steady through the brief dips of a pile that is being worked down.
 *
 *   on:   pile >= MIN_PILE and at least LEAD_ON more than every other station,
 *         held for ON_HOLD_S;
 *   stay: pile >= MIN_PILE and still strictly the largest;
 *   off:  the stay condition false for OFF_HOLD_S (or the pile is empty).
 *
 * Times are wall seconds (what the room sees). Pure.
 */
export const MIN_PILE = 2;
export const LEAD_ON = 2;
export const ON_HOLD_S = 0.6;
export const OFF_HOLD_S = 1.5;

export interface AlertState {
  /** The station glowing now, or null. */
  readonly on: string | null;
  /** Station that meets the "on" condition, and since when. */
  readonly candidate: string | null;
  readonly candidateSince: number;
  /** When the glowing station stopped meeting the "stay" condition, or null. */
  readonly failingSince: number | null;
}

export const NO_ALERT: AlertState = { on: null, candidate: null, candidateSince: 0, failingSince: null };

function lead(counts: Readonly<Record<string, number>>, id: string): number {
  const mine = counts[id] ?? 0;
  const others = Object.entries(counts).filter(([k]) => k !== id).map(([, v]) => v);
  return mine - Math.max(0, ...others);
}

function leader(counts: Readonly<Record<string, number>>): string | null {
  const ids = Object.keys(counts).filter((id) => (counts[id] ?? 0) >= MIN_PILE && lead(counts, id) >= LEAD_ON);
  return ids[0] ?? null;
}

/** Next state from the tickets at each station (stations only) at time `now`. */
export function nextAlert(state: AlertState, counts: Readonly<Record<string, number>>, now: number): AlertState {
  const cand = leader(counts);
  const candidateSince = cand === state.candidate ? state.candidateSince : now;
  if (state.on !== null) {
    const holds = (counts[state.on] ?? 0) >= MIN_PILE && lead(counts, state.on) >= 1;
    if (holds) return { on: state.on, candidate: cand, candidateSince, failingSince: null };
    if ((counts[state.on] ?? 0) === 0) return { on: null, candidate: cand, candidateSince, failingSince: null };
    const failingSince = state.failingSince ?? now;
    if (now - failingSince < OFF_HOLD_S) return { on: state.on, candidate: cand, candidateSince, failingSince };
    return { on: null, candidate: cand, candidateSince, failingSince: null };
  }
  const on = cand !== null && now - candidateSince >= ON_HOLD_S ? cand : null;
  return { on, candidate: cand, candidateSince, failingSince: null };
}
