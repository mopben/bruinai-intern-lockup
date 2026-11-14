/**
 * Step 1. The scan appears; the owner names things and says how an order is made.
 */
import { addFloorMark, addRouteStation, moveRouteStep, removeRouteStep, toggleFetch } from "../app/kitchen-edit";
import { editKitchen, reveal } from "../state/kitchen-actions";
import { base, kitchen, kitchenOrigin, moveInScan, scanNotes, scanState, selectedId, serverInfo, sources } from "../state/store";
import { Btn } from "./bits";
import { ItemPanel } from "./ItemPanel";

function RouteEditor() {
  const k = kitchen.value;
  if (!k) return null;
  const name = (id: string) => k.setup.items.find((i) => i.boxId === id)?.name ?? id;
  const steps = k.setup.menu[0]?.steps ?? [];
  const inRoute = new Set(steps.map((s) => s.stationId));
  const spare = k.setup.items.filter((i) => i.role === "station" && !inRoute.has(i.boxId));
  const storage = k.setup.items.filter((i) => i.role === "storage");
  const pickup = k.setup.items.find((i) => i.boxId === k.setup.pickupId);
  const editable = kitchenOrigin.value === "live";
  return (
    <div class="st-field" data-testid="route">
      <span>How an order is made{k.setup.menu[0] ? ` (${k.setup.menu[0].name})` : ""}</span>
      <div class="st-route">
        {steps.map((s, i) => (
          <>
            <span class="stop" key={s.stationId}>
              {name(s.stationId)}
              {(s.fetchFrom ?? []).length > 0 ? <span class="fetch">{`, gets ${s.fetchFrom?.map(name).join(", ")}`}</span> : null}
              {editable ? (
                <>
                  <button type="button" aria-label={`Move ${name(s.stationId)} earlier`} disabled={i === 0} onClick={() => editKitchen((x) => moveRouteStep(x, i, -1))}>‹</button>
                  <button type="button" aria-label={`Move ${name(s.stationId)} later`} disabled={i === steps.length - 1} onClick={() => editKitchen((x) => moveRouteStep(x, i, 1))}>›</button>
                  <button type="button" aria-label={`Take ${name(s.stationId)} out`} onClick={() => editKitchen((x) => removeRouteStep(x, i))}>×</button>
                </>
              ) : null}
            </span>
            <span class="arrow" aria-hidden="true">→</span>
          </>
        ))}
        <span class="stop end">{pickup ? pickup.name : "no pickup yet"}</span>
      </div>
      {editable && spare.length > 0 ? (
        <div class="st-chips">
          {spare.map((s) => (
            <button key={s.boxId} type="button" class="st-pick" onClick={() => editKitchen((x) => addRouteStation(x, s.boxId))}>
              + {s.name}
            </button>
          ))}
        </div>
      ) : null}
      {editable && storage.length > 0 && steps.length > 0 ? (
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
      <p class="st-lede">Sweep the phone around the counter with the Dry Run app. The kitchen appears here when the scan arrives.</p>
      {info ? (
        <p class="st-small">
          The app sends to <strong>{info.urls.scanUpload}</strong>
        </p>
      ) : (
        <p class="st-warn">Not connected to the laptop server, so the phone cannot reach this screen.</p>
      )}
      <p class="st-small">Or drop a scan.json file anywhere on this screen.</p>
      <p class="st-small">To use the recorded scan instead, press I and switch the scan to recorded.</p>
    </div>
  );
}

export function ScanRail() {
  const k = kitchen.value;
  if (!k) return <Waiting />;
  const id = selectedId.value;
  if (id) return <ItemPanel boxId={id} />;
  const recorded = kitchenOrigin.value === "recorded";
  if (scanState.value === "revealing") {
    return (
      <div class="st-card">
        <h1>The kitchen, from a phone scan</h1>
        <p class="st-say">
          <span class="st-pulse" />
          Reading the scan…
        </p>
        <p class="st-lede">Each box is something the scanner found, at its real size and place.</p>
      </div>
    );
  }
  const addMark = () => {
    const current = kitchen.value;
    if (!current) return;
    const result = addFloorMark(current);
    editKitchen(() => result.kitchen);
    moveInScan.value = true;
    selectedId.value = result.newId;
  };
  return (
    <div class="st-card">
      <h1>The kitchen, from a phone scan</h1>
      <p class="st-lede">Real sizes and positions. The scanner only knows household names, so click any box to rename it or say what it is.</p>
      {scanNotes.value.map((n) => (
        <p class="st-warn" key={n}>
          {n}
        </p>
      ))}
      <RouteEditor />
      <div class="st-row">
        <Btn label="Show the scan again" k="P" onClick={reveal} testId="btn-play" />
        <Btn label="Add a floor mark" onClick={addMark} testId="btn-add-mark" />
      </div>
      <p class="st-small">
        {recorded ? `Recorded scan, from the run “${base.value?.meta.title ?? ""}”.` : sources.value.scan === "live" ? "Live scan from the phone. This is a first guess: check each box." : ""}
        {" "}A scanner cannot see tape on the floor: add a floor mark for a queue or pickup spot.
      </p>
    </div>
  );
}
