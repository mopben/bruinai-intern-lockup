/**
 * Per-step walking plan for each menu item: what a worker walks for each step
 * under the staged-run protocol. Built from the layout alone.
 */
import type { World } from "./world";
import { buildPathTable, walkingForItem, type PathTable, type WalkLeg } from "./walking";

export interface StepPlan {
  readonly step: number;
  readonly stationId: string;
  /** Fetch legs in order (one round trip each). */
  readonly fetchLegs: readonly WalkLeg[];
  /** Total fetch walking, there and back, in metres. */
  readonly fetchM: number;
  /** Carry to the next station (or pickup). */
  readonly carry: WalkLeg;
}

export interface ItemPlan {
  readonly itemId: string;
  readonly steps: readonly StepPlan[];
}

export function planItems(world: World, table?: PathTable): ReadonlyMap<string, ItemPlan> {
  const t = table ?? buildPathTable(world);
  const out = new Map<string, ItemPlan>();
  for (const m of world.menu) {
    const walk = walkingForItem(world, m.id, t);
    const steps: StepPlan[] = m.steps.map((s, k) => {
      const fetchLegs = walk.legs.filter((l) => l.step === k && l.kind === "fetch");
      const carry = walk.legs.find((l) => l.step === k && l.kind === "carry") as WalkLeg;
      return { step: k, stationId: s.stationId, fetchLegs, fetchM: fetchLegs.reduce((a, l) => a + l.roundTripM, 0), carry };
    });
    out.set(m.id, { itemId: m.id, steps });
  }
  return out;
}
