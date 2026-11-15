/**
 * A new shift for a kitchen that has its own menu (a filmed run, not the
 * bundled café counter): the kitchen's own orders and step times, with an
 * illustrative demand. Pure.
 */
import type { Calibration, MenuPrice, Setup } from "../../core";
import { mulberry32 } from "../../core/rng";
import type { Kitchen } from "./kitchen-edit";
import { shiftOrders, type ShiftOrders } from "./scenarios";

/** Illustrative demand, not measured: one order a minute for an hour. */
export const RUN_SHIFT_SECONDS = 3600;
export const RUN_SHIFT_ORDERS = 60;
const RUN_SHIFT_SEED = 1577;
const CAFE_RECIPE_ID = "latte";

/** True for the bundled espresso counter, whose new shifts start from the café demo. */
export function hasCafeMenu(setup: Setup): boolean {
  return setup.menu.some((recipe) => recipe.id === CAFE_RECIPE_ID);
}

/**
 * The kitchen's own menu with the step seconds measured from its run (shiftOrders: the mean of
 * the taps per station, its default where a station has no measurement), and RUN_SHIFT_ORDERS
 * arrivals spread over RUN_SHIFT_SECONDS, shared evenly between the menu items. No prices are
 * set, so the app's example prices apply and say so.
 */
export function runShift(kitchen: Kitchen, calibration: Calibration | null): ShiftOrders & { durationSeconds: number; prices: Record<string, MenuPrice> } {
  const own = shiftOrders(kitchen, calibration);
  if (own.menu.length === 0) throw new Error("Add an order to this kitchen before creating a shift.");
  const rng = mulberry32(RUN_SHIFT_SEED);
  // Independently sampled arrivals, as in the café demo: short queues and quiet gaps.
  const arrivals = Array.from({ length: RUN_SHIFT_ORDERS }, () => Math.floor(rng() * RUN_SHIFT_SECONDS)).sort((a, b) => a - b);
  const orders = arrivals.map((t, index) => ({ orderId: `shift-${index + 1}`, itemId: own.menu[index % own.menu.length]!.id, t }));
  return { ...own, schedule: { orders }, durationSeconds: RUN_SHIFT_SECONDS, prices: {} };
}
