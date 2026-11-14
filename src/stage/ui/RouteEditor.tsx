/**
 * The order route editor: which stations an order visits, in which order, and
 * which storages each step fetches from. Only for a live scan's starter setup.
 */
import { addRouteStation, moveRouteStep, removeRouteStep, toggleFetch } from "../app/kitchen-edit";
import { editKitchen } from "../state/kitchen-actions";
import { kitchen, kitchenOrigin } from "../state/store";

export function RouteEditor() {
  const k = kitchen.value;
  if (!k || kitchenOrigin.value !== "live") return null;
  const name = (id: string) => k.setup.items.find((i) => i.boxId === id)?.name ?? id;
  const steps = k.setup.menu[0]?.steps ?? [];
  const inRoute = new Set(steps.map((s) => s.stationId));
  const spare = k.setup.items.filter((i) => i.role === "station" && !inRoute.has(i.boxId));
  const storage = k.setup.items.filter((i) => i.role === "storage");
  const pickup = k.setup.items.find((i) => i.boxId === k.setup.pickupId);
  return (
    <div class="st-field" data-testid="route">
      <span>Order route</span>
      <div class="st-route">
        {steps.map((s, i) => (
          <>
            <span class="stop" key={s.stationId}>
              {name(s.stationId)}
              {(s.fetchFrom ?? []).length > 0 ? <span class="fetch">{`, gets ${s.fetchFrom?.map(name).join(", ")}`}</span> : null}
              <button type="button" aria-label={`Move ${name(s.stationId)} earlier`} disabled={i === 0} onClick={() => editKitchen((x) => moveRouteStep(x, i, -1))}>‹</button>
              <button type="button" aria-label={`Move ${name(s.stationId)} later`} disabled={i === steps.length - 1} onClick={() => editKitchen((x) => moveRouteStep(x, i, 1))}>›</button>
              <button type="button" aria-label={`Take ${name(s.stationId)} out`} onClick={() => editKitchen((x) => removeRouteStep(x, i))}>×</button>
            </span>
            <span class="arrow" aria-hidden="true">→</span>
          </>
        ))}
        <span class="stop end">{pickup ? pickup.name : "no pickup yet"}</span>
      </div>
      {spare.length > 0 ? (
        <div class="st-chips">
          {spare.map((s) => (
            <button key={s.boxId} type="button" class="st-pick" onClick={() => editKitchen((x) => addRouteStation(x, s.boxId))}>
              + {s.name}
            </button>
          ))}
        </div>
      ) : null}
      {storage.length > 0 && steps.length > 0 ? (
        <div class="st-chips">
          {steps.flatMap((s, i) =>
            storage.map((st) => {
              const on = (s.fetchFrom ?? []).includes(st.boxId);
              return (
                <button key={`${i}-${st.boxId}`} type="button" class={`st-pick${on ? " on" : ""}`} onClick={() => editKitchen((x) => toggleFetch(x, i, st.boxId))}>
                  {name(s.stationId)} gets {st.name}
                </button>
              );
            }),
          )}
        </div>
      ) : null}
    </div>
  );
}
