/**
 * The two numbers for a layout: walking per order (exact) and time per order
 * (a simulated range). Everything comes from src/core; when the model cannot
 * compute a number, the reason is returned in plain words instead.
 */
import {
  SimError,
  WorldError,
  buildPathTable,
  predict,
  resolveWorld,
  walkingPerOrder,
  type Calibration,
  type Layout,
  type Prediction,
  type Releases,
  type Scan,
  type Setup,
  type WalkLeg,
  type World,
} from "../../core";

export type Computed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };

export interface Walking {
  readonly perOrderM: number;
  /** Walked legs (hand-offs left out), for drawing on the floor. */
  readonly legs: readonly WalkLeg[];
}

export interface LayoutNumbers {
  readonly walking: Computed<Walking>;
  readonly time: Computed<Prediction>;
  readonly world: World | null;
}

const fail = (message: string): { readonly ok: false; readonly message: string } => ({ ok: false, message });

/** A WorldError or SimError in words for the screen (first two issues). */
export function explainError(error: unknown): string {
  if (error instanceof WorldError) {
    const shown = error.issues.slice(0, 2).join(" ");
    return error.issues.length > 2 ? `${shown} (and ${error.issues.length - 2} more)` : shown;
  }
  if (error instanceof SimError) return error.message;
  return "The model could not work this out.";
}

/** Resolves a kitchen, or says why it cannot be. */
export function tryWorld(scan: Scan, setup: Setup, layout: Layout): Computed<World> {
  try {
    return { ok: true, value: resolveWorld(scan, setup, layout) };
  } catch (error) {
    return fail(explainError(error));
  }
}

function blockedMessage(world: World, legs: readonly WalkLeg[]): string | null {
  const leg = legs.find((l) => l.blocked);
  if (!leg) return null;
  const name = (id: string) => world.itemsById.get(id)?.name ?? id;
  return `No way through from ${name(leg.fromId)} to ${name(leg.toId)}. Make a gap to walk through.`;
}

/**
 * Both numbers for one layout. `calibration` is null before a run has been
 * measured; walking is still exact then.
 */
export function layoutNumbers(scan: Scan, setup: Setup, layout: Layout, calibration: Calibration | null, releases?: Releases): LayoutNumbers {
  const world = tryWorld(scan, setup, layout);
  if (!world.ok) return { walking: world, time: world, world: null };
  const w = world.value;
  let table;
  let summary;
  try {
    table = buildPathTable(w);
    summary = walkingPerOrder(w, table);
  } catch (error) {
    const message = explainError(error);
    return { walking: fail(message), time: fail(message), world: w };
  }
  const legs = [...summary.byItem.values()].flatMap((item) => item.legs).filter((l) => !l.handoff && l.oneWayM > 0);
  const blocked = blockedMessage(w, [...summary.byItem.values()].flatMap((item) => item.legs));
  if (blocked !== null) return { walking: fail(blocked), time: fail(blocked), world: w };
  const walking: Computed<Walking> = { ok: true, value: { perOrderM: summary.perOrderM, legs } };
  if (calibration === null) return { walking, time: fail("Run the kitchen once to measure how long each step takes."), world: w };
  try {
    return { walking, time: { ok: true, value: predict(w, calibration, { table, releases }) }, world: w };
  } catch (error) {
    return { walking, time: fail(explainError(error)), world: w };
  }
}
