import type { Calibration, ItemSetup, MenuItem, Setup } from "../../core";
import type { Kitchen } from "./kitchen-edit";

export interface ShiftOrders {
  readonly menu: readonly MenuItem[];
  readonly schedule: Setup["schedule"];
  readonly items: readonly ItemSetup[];
}

/** Bind a reusable recipe to equivalent named stations in another kitchen. */
export function kitchenForShift(kitchen: Kitchen, shift: ShiftOrders): Kitchen {
  const bind = (id: string): string => {
    const source = shift.items.find((item) => item.boxId === id);
    const exact = kitchen.setup.items.find((item) => item.boxId === id && item.role === source?.role);
    if (exact) return exact.boxId;
    const matches = kitchen.setup.items.filter((item) => source && item.role === source.role && item.name.trim().toLowerCase() === source.name.trim().toLowerCase());
    if (matches.length !== 1) throw new Error(`This shift needs ${source?.name ?? id}. Add or name a matching ${source?.role ?? "station"} in this setup.`);
    return matches[0]!.boxId;
  };
  const menu = shift.menu.map((recipe) => ({ ...recipe, steps: recipe.steps.map((step) => ({
    ...step, stationId: bind(step.stationId), fetchFrom: step.fetchFrom?.map(bind),
  })) }));
  return { ...kitchen, setup: { ...kitchen.setup, menu, schedule: shift.schedule } };
}

/** Save explicit preparation times so a shift can run without the original recording. */
export function shiftOrders(kitchen: Kitchen, calibration: Calibration | null): ShiftOrders {
  return {
    menu: kitchen.setup.menu.map((recipe) => ({ ...recipe, steps: recipe.steps.map((step) => {
      const samples = calibration?.workSamples[step.stationId] ?? [];
      const mean = samples.length ? samples.reduce((a, b) => a + b, 0) / samples.length : 10;
      return { ...step, workSeconds: step.workSeconds ?? Math.round(mean * 10) / 10 };
    }) })),
    schedule: kitchen.setup.schedule,
    items: kitchen.setup.items,
  };
}

export const ASSUMED_CALIBRATION: Calibration = {
  walkSpeedMps: 1.2, walkOverheadS: 0, paceMethod: "assumed", paceTrips: [],
  walkSpeedAssumed: true, walkSpeedSamples: 0, workSamples: {}, sampleCount: 0,
  clampedCount: 0, orderIds: [], warnings: ["Walking speed assumed at 1.2 m/s."],
};
