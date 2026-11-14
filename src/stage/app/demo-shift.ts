import type { MenuPrice, Setup } from "../../core";
import { mulberry32 } from "../../core/rng";
import type { ShiftOrders } from "./scenarios";

export const DEMO_SHIFT_SECONDS = 6 * 3600;
export const MAX_RECIPE_QUANTITY = 2000;
export const DEMO_HOURLY_ORDERS = [40, 90, 80, 55, 55, 40] as const;

/** Illustrative small-café morning, not measured demand or preparation times. */
export function demoShift(setup: Setup): ShiftOrders & { durationSeconds: number; prices: Record<string, MenuPrice> } {
  const template = setup.menu.find(recipe => recipe.id === "latte") ?? setup.menu[0];
  if (!template) throw new Error("Add a recipe before loading the café demo.");
  const recipes = [
    { id: "latte", name: "Latte", count: 180, prep: 45, milk: true, price: 5, ingredients: 1.4 },
    { id: "cappuccino", name: "Cappuccino", count: 108, prep: 55, milk: true, price: 5, ingredients: 1.2 },
    { id: "espresso", name: "Espresso", count: 72, prep: 25, milk: false, price: 3, ingredients: 0.6 },
  ];
  const menu = recipes.map(recipe => ({
    id: recipe.id, name: recipe.name,
    steps: template.steps.map((step, index) => ({
      ...step,
      fetchFrom: recipe.milk ? step.fetchFrom : undefined,
      workSeconds: template.steps.length === 1 ? recipe.prep : index === 0 ? 15 : index === 1 ? recipe.prep : 10,
    })),
  }));
  const rng = mulberry32(601);
  const mix = recipes.flatMap(recipe => Array<string>(recipe.count).fill(recipe.id));
  for (let i = mix.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [mix[i], mix[j]] = [mix[j]!, mix[i]!];
  }
  // Independently sampled arrivals produce short queues and quiet gaps within each hour.
  const arrivals = DEMO_HOURLY_ORDERS.flatMap((count, hour) =>
    Array.from({ length: count }, () => hour * 3600 + Math.floor(rng() * 3600)),
  ).sort((a, b) => a - b);
  return {
    menu, items: setup.items, durationSeconds: DEMO_SHIFT_SECONDS,
    prices: Object.fromEntries(recipes.map(recipe => [recipe.id, { price: recipe.price, ingredients: recipe.ingredients }])),
    schedule: { orders: arrivals.map((t, index) => ({ orderId: `demo-${index + 1}`, itemId: mix[index]!, t })) },
  };
}
