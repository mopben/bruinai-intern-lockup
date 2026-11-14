/**
 * Step 1. The scan appears and the owner names things. The Inputs section
 * sits at the bottom of the panel.
 */
import { useRef } from "preact/hooks";
import { addFloorMark, addRouteStation, moveRouteStep, removeRouteStep, toggleFetch } from "../app/kitchen-edit";
import { acceptDroppedScan } from "../state/input-actions";
import { editKitchen, reveal } from "../state/kitchen-actions";
import { addNotice, kitchen, kitchenOrigin, moveInScan, scanNotes, scanState, selectedId, serverInfo } from "../state/store";
import { Btn } from "./bits";
import { InputsSection } from "./InputsSection";
import { ItemPanel } from "./ItemPanel";

function RouteEditor() {
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

function Waiting() {
  const info = serverInfo.value;
  return (
    <div class="st-card" data-testid="scan-waiting">
      <h1>
        <span class="st-pulse" />
        Waiting for the phone
      </h1>
      {info ? null : <p class="st-warn">Not connected to the laptop server, so the phone cannot reach this screen.</p>}
    </div>
  );
}

export function ScanRail() {
  const file = useRef<HTMLInputElement>(null);
  const addMark = () => {
    const current = kitchen.value;
    if (!current) return;
    const result = addFloorMark(current);
    editKitchen(() => result.kitchen);
    moveInScan.value = true;
    selectedId.value = result.newId;
  };
  const pick = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = "";
    if (!f) return;
    f.text().then(
      (text) => acceptDroppedScan(text, f.name),
      () => addNotice({ id: "drop", text: `Could not read ${f.name}.`, tone: "warn" }),
    );
  };
  return (
    <>
      <div class="st-row st-panel-actions">
        <Btn label="Add a scan" onClick={() => file.current?.click()} testId="btn-add-scan" />
        <Btn label="Add a floor mark" onClick={addMark} disabled={!kitchen.value} title={kitchen.value ? undefined : "Add a scan first"} testId="btn-add-mark" />
        <input ref={file} type="file" accept=".json,application/json" style={{ display: "none" }} onChange={pick} />
      </div>
      <ScanBody />
      <InputsSection />
    </>
  );
}

function ScanBody() {
  const k = kitchen.value;
  if (!k) return <Waiting />;
  const id = selectedId.value;
  if (id) return <ItemPanel boxId={id} />;
  if (scanState.value === "revealing") {
    return (
      <div class="st-card">
        <h1>The kitchen, from a phone scan</h1>
        <p class="st-say">
          <span class="st-pulse" />
          Reading the scan…
        </p>
      </div>
    );
  }
  return (
    <div class="st-card">
      <h1>The kitchen, from a phone scan</h1>
      {scanNotes.value.map((n) => (
        <p class="st-warn" key={n}>
          {n}
        </p>
      ))}
      <RouteEditor />
      <div class="st-row">
        <Btn label="Show the scan again" k="P" onClick={reveal} testId="btn-play" />
      </div>
    </div>
  );
}
