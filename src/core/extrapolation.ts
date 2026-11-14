/**
 * Is a layout asking the pace model for walks it never saw?
 *
 * The pace fit rests on the round-trip lengths measured in the calibration run.
 * A walk shorter or longer than all of them is an extrapolation: we say so in
 * words and the prediction then lets each replication draw its pace model from
 * both defensible estimates (fit and single effective speed).
 */
import type { World } from "./world";
import type { Calibration } from "./calibrate";
import { tripDistanceRange } from "./pace";
import { walkingForItem, type LegKind, type PathTable } from "./walking";

/** Walks within this of the measured range count as inside it. */
export const EXTRAPOLATION_TOLERANCE_M = 0.05;

export interface ExtrapolatedWalk {
  readonly kind: LegKind;
  readonly fromId: string;
  readonly toId: string;
  readonly roundTripM: number;
  readonly side: "shorter" | "longer";
}

export interface WalkExtrapolation {
  /** Some walk in this layout is outside the measured trip lengths. */
  readonly outside: boolean;
  /** Plain sentences, one per walk outside; "" when none. */
  readonly note: string;
  /** Round-trip lengths the pace was measured on; null when the pace did not come from trips. */
  readonly measuredRangeM: { readonly min: number; readonly max: number } | null;
  readonly walks: readonly ExtrapolatedWalk[];
}

function sentence(world: World, w: ExtrapolatedWalk): string {
  const name = (id: string): string => world.itemsById.get(id)?.name ?? id;
  const walk = w.kind === "fetch" ? `the walk to the ${name(w.toId)}` : `the walk from ${name(w.fromId)} to ${name(w.toId)}`;
  return `${walk.charAt(0).toUpperCase()}${walk.slice(1)} is ${w.side} than any walk we measured, so its time is less certain.`;
}

export function walkExtrapolation(world: World, cal: Calibration, table?: PathTable): WalkExtrapolation {
  const range = cal.paceMethod === "trip-fit" || cal.paceMethod === "trip-speed" ? tripDistanceRange(cal.paceTrips) : null;
  if (range === null) return { outside: false, note: "", measuredRangeM: null, walks: [] };
  const seen = new Set<string>();
  const walks: ExtrapolatedWalk[] = [];
  for (const m of world.menu) {
    for (const l of walkingForItem(world, m.id, table).legs) {
      const key = `${l.kind}:${l.fromId}:${l.toId}`;
      if (l.roundTripM <= 0 || seen.has(key)) continue;
      seen.add(key);
      const side = l.roundTripM < range.min - EXTRAPOLATION_TOLERANCE_M ? "shorter" : l.roundTripM > range.max + EXTRAPOLATION_TOLERANCE_M ? "longer" : null;
      if (side) walks.push({ kind: l.kind, fromId: l.fromId, toId: l.toId, roundTripM: l.roundTripM, side });
    }
  }
  return { outside: walks.length > 0, note: walks.map((w) => sentence(world, w)).join(" "), measuredRangeM: range, walks };
}
