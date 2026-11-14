/**
 * Step 1. The scan appears, floor marks and further scans can be added, and
 * the Inputs section sits at the bottom of the panel.
 */
import { useRef } from "preact/hooks";
import { addFloorMark } from "../app/kitchen-edit";
import { acceptDroppedScan } from "../state/input-actions";
import { editKitchen, reveal } from "../state/kitchen-actions";
import { addNotice, kitchen, moveInScan, scanNotes, scanState, serverInfo } from "../state/store";
import { Btn } from "./bits";
import { InputsSection } from "./InputsSection";

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
    if (!kitchen.value) return;
    editKitchen((x) => addFloorMark(x).kitchen);
    moveInScan.value = true;
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
      <div class="st-row">
        <Btn label="Show the scan again" k="P" onClick={reveal} testId="btn-play" />
      </div>
    </div>
  );
}
