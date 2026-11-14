import type { MenuItem, Setup, StepDef } from "../../core";
import type { Kitchen } from "./kitchen-edit";
import { addWorker } from "./kitchen-edit";
import { MAX_RECIPE_QUANTITY } from "./demo-shift";

/** Keep the recorded Latte and its schedule intact; offer two more demo recipes. */
export function withDemoRecipes(setup: Setup): Setup {
  if (setup.menu.length !== 1 || setup.menu[0]?.id !== "latte") return setup;
  const latte = setup.menu[0];
  return { ...setup, menu: [latte, ...[
    { id: "espresso", name: "Espresso", seconds: 10, milk: false },
    { id: "cappuccino", name: "Cappuccino", seconds: 18, milk: true },
  ].map((recipe) => ({
    id: recipe.id, name: recipe.name,
    steps: latte.steps.map((step, i) => ({ ...step, fetchFrom: recipe.milk ? step.fetchFrom : undefined, workSeconds: i === 1 ? recipe.seconds : 3 })),
  }))] };
}

export function updateRecipe(k: Kitchen, id: string, change: Partial<MenuItem>): Kitchen {
  return { ...k, setup: { ...k.setup, menu: k.setup.menu.map((m) => m.id === id ? { ...m, ...change, id } : m) } };
}

export function createRecipe(k: Kitchen): { kitchen: Kitchen; id: string } {
  let n = 1;
  while (k.setup.menu.some((m) => m.id === `recipe-${n}`)) n++;
  const id = `recipe-${n}`;
  const station = k.setup.items.find((s) => s.role === "station");
  const steps: StepDef[] = station ? [{ stationId: station.boxId, workSeconds: 10 }] : [];
  const layout = station && !k.layout.workers.some((w) => w.stationId === station.boxId) ? addWorker(k.layout, station.boxId) : k.layout;
  return { id, kitchen: { ...k, layout, setup: { ...k.setup, menu: [...k.setup.menu, { id, name: `New order ${n}`, steps }] } } };
}

export function setRecipeQuantity(k: Kitchen, id: string, quantity: number): Kitchen {
  if (!Number.isFinite(quantity)) return k;
  const count = Math.max(0, Math.min(MAX_RECIPE_QUANTITY, Math.floor(quantity)));
  const orders = k.setup.schedule.orders;
  const current = orders.filter((o) => o.itemId === id);
  let next = orders.filter((o) => o.itemId !== id || current.indexOf(o) < count);
  let t = Math.max(0, ...orders.map((o) => o.t));
  let n = 1;
  for (let i = current.length; i < count; i++) {
    while (next.some((o) => o.orderId === `custom-${n}`)) n++;
    t += 6;
    next = [...next, { orderId: `custom-${n++}`, itemId: id, t }];
  }
  return { ...k, setup: { ...k.setup, schedule: { orders: next } } };
}
