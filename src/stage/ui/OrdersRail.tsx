import { savedShifts, setShiftFinance } from "../state/workspace";
import { economics } from "../state/economics";
import { useState } from "preact/hooks";
import type { MenuItem, StepDef } from "../../core";
import { createRecipe, setRecipeQuantity, updateRecipe } from "../app/recipes";
import { addWorker } from "../app/kitchen-edit";
import { calibration } from "../state/derive";
import { editKitchen } from "../state/kitchen-actions";
import { activeShiftId, kitchen, orderCount } from "../state/store";
import { ShiftControls } from "./LibraryControls";
import { MAX_RECIPE_QUANTITY } from "../app/demo-shift";

function RecipeCard({ recipe, initiallyOpen }: { recipe: MenuItem; initiallyOpen: boolean }) {
  const k = kitchen.value!;
  const shift = savedShifts.value.find(s => s.id === activeShiftId.value);
  const price = shift?.prices?.[recipe.id] ?? economics.value?.menu[recipe.id];
  const money = (field: "price" | "ingredients", value: number) => setShiftFinance({ prices: { [recipe.id]: { price: price?.price ?? 4.5, ingredients: price?.ingredients ?? 1.2, [field]: value } } });
  const stations = k.setup.items.filter((s) => s.role === "station");
  const storage = k.setup.items.filter((s) => s.role === "storage");
  const cal = calibration.value;
  const measured = (id: string) => {
    const samples = cal?.ok ? cal.value.workSamples[id] ?? [] : [];
    return samples.length ? Math.round(samples.reduce((a, b) => a + b, 0) / samples.length * 10) / 10 : 10;
  };
  const change = (value: Partial<MenuItem>) => editKitchen((x) => updateRecipe(x, recipe.id, value));
  const steps = (value: readonly StepDef[]) => change({ steps: value });
  const count = k.setup.schedule.orders.filter((o) => o.itemId === recipe.id).length;
  const total = recipe.steps.reduce((sum, s) => sum + (s.workSeconds ?? measured(s.stationId)), 0);
  return (
    <details class="st-recipe" open={initiallyOpen} data-testid={`recipe-${recipe.id}`}>
      <summary><span>{recipe.name || "Untitled order"}</span><small>{recipe.steps.length} steps · {total.toFixed(0)}s · {count} orders</small></summary>
      <div class="st-recipe-body">
        <label class="st-field">Order name<input aria-label="Order name" autoFocus={initiallyOpen} maxLength={60} value={recipe.name} onInput={(e) => change({ name: e.currentTarget.value })} /></label>
        <label class="st-field">Quantity in simulation<input type="number" min="0" max={MAX_RECIPE_QUANTITY} step="1" value={count} onChange={(e) => {
          const value = e.currentTarget.valueAsNumber;
          if (!Number.isFinite(value)) return;
          editKitchen((x) => setRecipeQuantity(x, recipe.id, value));
          orderCount.value = null;
        }} /></label>
        <div class="st-cost-grid">
          {(["price", "ingredients"] as const).map(field => <label class="st-field" key={field}>{field === "price" ? "Selling price" : "Ingredient cost"}<input aria-label={field === "price" ? "Selling price" : "Ingredient cost"} type="number" min="0" step="0.01" value={price?.[field] ?? (field === "price" ? 4.5 : 1.2)} onChange={event => { const v = event.currentTarget.valueAsNumber; if (Number.isFinite(v) && v >= 0) money(field, v); }} /></label>)}
        </div>
        {!shift?.prices?.[recipe.id] ? <p class="st-small">Prices use setup values or examples until you enter them here.</p> : null}
        <ol class="st-recipe-steps">
          {recipe.steps.map((step, i) => (
            <li key={i}>
              <div class="st-recipe-line">
                <span class="st-recipe-number">{i + 1}</span>
                <strong>{k.setup.items.find((s) => s.boxId === step.stationId)?.name ?? step.stationId}</strong>
                <label><input aria-label={`Seconds at step ${i + 1}`} type="number" min="0" max="3600" step="0.1" value={step.workSeconds ?? measured(step.stationId)} onChange={(e) => {
                  const value = e.currentTarget.valueAsNumber;
                  if (Number.isFinite(value)) steps(recipe.steps.map((s, j) => j === i ? { ...s, workSeconds: Math.max(0, Math.min(3600, value)) } : s));
                }} /> s</label>
              </div>
              <div class="st-row">
                <button type="button" aria-label={`Move step ${i + 1} earlier`} disabled={i === 0} onClick={() => { const next = [...recipe.steps]; [next[i - 1], next[i]] = [next[i]!, next[i - 1]!]; steps(next); }}>↑</button>
                <button type="button" aria-label={`Move step ${i + 1} later`} disabled={i === recipe.steps.length - 1} onClick={() => { const next = [...recipe.steps]; [next[i], next[i + 1]] = [next[i + 1]!, next[i]!]; steps(next); }}>↓</button>
                <button type="button" disabled={recipe.steps.length === 1} onClick={() => steps(recipe.steps.filter((_, j) => j !== i))}>Remove step</button>
              </div>
              {storage.length ? <div class="st-recipe-fetch">{storage.map((s) => <label key={s.boxId}><input type="checkbox" checked={step.fetchFrom?.includes(s.boxId) ?? false} onChange={(e) => {
                const fetchFrom = e.currentTarget.checked ? [...(step.fetchFrom ?? []), s.boxId] : (step.fetchFrom ?? []).filter((id) => id !== s.boxId);
                steps(recipe.steps.map((value, j) => j === i ? { ...value, fetchFrom } : value));
              }} /> Fetch from {s.name}</label>)}</div> : null}
            </li>
          ))}
        </ol>
        <label class="st-field">Add a preparation step<select aria-label="Add a preparation step" value="" onChange={(e) => {
          const stationId = e.currentTarget.value;
          if (!stationId) return;
          editKitchen((x) => {
            const next = updateRecipe(x, recipe.id, { steps: [...recipe.steps, { stationId, workSeconds: 10 }] });
            return next.layout.workers.some((w) => w.stationId === stationId) ? next : { ...next, layout: addWorker(next.layout, stationId) };
          });
          e.currentTarget.value = "";
        }}><option value="">Choose a station…</option>{stations.map((s) => <option key={s.boxId} value={s.boxId}>{s.name}</option>)}</select></label>
        <p class="st-note">Then carry to {k.setup.items.find((s) => s.boxId === k.setup.pickupId)?.name ?? "pickup"}. Walking and fetching add to preparation time.</p>
      </div>
    </details>
  );
}

export function OrdersRail() {
  const [created, setCreated] = useState<string | null>(null);
  const k = kitchen.value;
  if (!k) return <div class="st-card"><h1>Orders</h1><p>Import a kitchen to create orders.</p></div>;
  const hasStations = k.setup.items.some((s) => s.role === "station");
  return <div class="st-card" data-testid="orders-rail">
    <ShiftControls />
    {activeShiftId.value ? <label class="st-field">Shift duration (hours)<input data-testid="shift-hours" type="number" min="0.01" max="168" step="0.25" value={(savedShifts.value.find(s => s.id === activeShiftId.value)?.durationSeconds ?? 3600) / 3600} onChange={event => { const v = event.currentTarget.valueAsNumber; if (Number.isFinite(v) && v > 0 && v <= 168) setShiftFinance({ durationSeconds: v * 3600 }); }} /></label> : null}
    {activeShiftId.value ? <>
    <h2>Orders</h2>
    <div class="st-recipes">{k.setup.menu.map((recipe) => <RecipeCard key={recipe.id} recipe={recipe} initiallyOpen={created === recipe.id} />)}</div>
    <button type="button" class="st-add-recipe" aria-label="Create new order" disabled={!hasStations} onClick={() => {
      let id = "";
      editKitchen((x) => { const result = createRecipe(x); id = result.id; return result.kitchen; });
      setCreated(id);
    }}><span aria-hidden="true">+</span> New order</button>
    {!hasStations ? <p class="st-note">Mark a kitchen item as a station in Edit to start making orders.</p> : null}
    {k.setup.schedule.orders.length ? <details class="st-recipe" data-testid="shift-arrivals">
      <summary>Order arrivals · {k.setup.schedule.orders.length} orders</summary>
      <div class="st-recipe-body">
        {k.setup.schedule.orders.map((order) => <label class="st-field" key={order.orderId}>
          <span>{k.setup.menu.find((recipe) => recipe.id === order.itemId)?.name ?? order.itemId} · {order.orderId} · arrival (seconds)</span>
          <input type="number" min="0" step="1" aria-label={`Arrival for ${order.orderId}`} value={order.t} onChange={(event) => {
            const t = event.currentTarget.valueAsNumber;
            if (!Number.isFinite(t) || t < 0) return;
            editKitchen((current) => ({ ...current, setup: { ...current.setup, schedule: {
              orders: current.setup.schedule.orders.map((entry) => entry.orderId === order.orderId ? { ...entry, t } : entry).sort((a, b) => a.t - b.t),
            } } }));
          }} />
        </label>)}
      </div>
    </details> : null}
    </> : null}
  </div>;
}
