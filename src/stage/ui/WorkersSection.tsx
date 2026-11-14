import { useEffect, useRef, useState } from "preact/hooks";
import type { Layout, WorkerDef } from "../../core";
import { addWorker } from "../app/kitchen-edit";
import { economics, setWorkerSalary, workersOpen } from "../state/economics";
import { cancelSuggest } from "../state/suggest";
import { kitchen, playLayout } from "../state/store";
import { Btn } from "./bits";

/** A native modal keeps keyboard focus and scene interactions inside worker management. */
export function WorkersSection() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [newName, setNewName] = useState("");
  const [newStation, setNewStation] = useState("");
  const k = kitchen.value;
  const layout = playLayout.value ?? k?.layout;
  const econ = economics.value;
  const [newSalary, setNewSalary] = useState(String(econ?.wagePerHour ?? 18));
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.showModal();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  if (!k || !layout || !econ) return null;
  const stations = k.setup.items.filter((item) => item.role === "station");
  const stationId = stations.some((station) => station.boxId === newStation) ? newStation : stations[0]?.boxId ?? "";
  const close = () => (workersOpen.value = false);
  const update = (next: Layout) => {
    cancelSuggest();
    playLayout.value = next;
  };
  const changeWorker = (id: string, change: Partial<WorkerDef>) => {
    const current = playLayout.peek() ?? k.layout;
    update({ ...current, workers: current.workers.map((worker) => worker.id === id ? { ...worker, ...change } : worker) });
  };
  return (
    <dialog ref={dialog} class="st-workers-dialog" data-testid="workers-section" aria-labelledby="workers-title" onCancel={(event) => { event.preventDefault(); close(); }}>
      <header class="st-workers-head">
        <div><h1 id="workers-title">Workers</h1><p>Manage your team, stations, and hourly pay.</p></div>
        <Btn label="Done" k="Esc" onClick={close} testId="btn-close-workers" />
      </header>
      <div class="st-workers-body">
        <section class="st-workers-roster" aria-label="Current workers">
          <h2>Your team <span class="st-workers-count">{layout.workers.length}</span></h2>
          {layout.workers.length === 0 ? <p class="st-small">Your team is empty. Add your first worker below.</p> : null}
          <div class="st-workers-list">
            {layout.workers.map((worker) => (
              <div class="st-worker-card" key={worker.id} data-testid={`worker-${worker.id}`}>
                <label class="st-field st-worker-color"><span>Hat color</span><input type="color" value={worker.color} aria-label={`Hat color for ${worker.name}`} onChange={(event) => changeWorker(worker.id, { color: event.currentTarget.value })} /></label>
                <label class="st-field"><span>Name</span><input class="st-input" value={worker.name} maxLength={80} aria-label={`Name for ${worker.name}`} data-testid={`worker-name-${worker.id}`} onChange={(event) => {
                  const name = event.currentTarget.value.trim();
                  if (name) changeWorker(worker.id, { name });
                  else event.currentTarget.value = worker.name;
                }} /></label>
                <label class="st-field"><span>Station</span><select class="st-input" value={worker.stationId} aria-label={`Station for ${worker.name}`} data-testid={`worker-station-${worker.id}`} onChange={(event) => changeWorker(worker.id, { stationId: event.currentTarget.value })}>
                  {stations.map((station) => <option key={station.boxId} value={station.boxId}>{station.name}</option>)}
                </select></label>
                <label class="st-field st-cost"><span>Hourly salary</span><span class="st-cost-input"><input class="st-input" type="number" min={0} step="0.01" value={econ.workerWages?.[worker.id] ?? econ.wagePerHour} aria-label={`Hourly salary for ${worker.name}`} data-testid={`worker-salary-${worker.id}`} onChange={(event) => {
                  const input = event.currentTarget;
                  if (input.value.trim() && input.validity.valid && Number.isFinite(input.valueAsNumber)) {
                    cancelSuggest();
                    setWorkerSalary(worker.id, input.valueAsNumber);
                  } else input.value = String(econ.workerWages?.[worker.id] ?? econ.wagePerHour);
                }} /><span class="unit">{econ.currency}/h</span></span></label>
                <Btn small label="Remove" title={`Remove ${worker.name}`} testId={`worker-remove-${worker.id}`} onClick={() => {
                  const current = playLayout.peek() ?? k.layout;
                  update({ ...current, workers: current.workers.filter((w) => w.id !== worker.id) });
                }} />
              </div>
            ))}
          </div>
        </section>
        <form class="st-worker-add" data-testid="worker-add-form" onSubmit={(event) => {
          event.preventDefault();
          const salary = Number(newSalary);
          if (!stationId || !newName.trim() || !newSalary.trim() || !Number.isFinite(salary) || salary < 0) return;
          const next = addWorker(playLayout.peek() ?? k.layout, stationId);
          const added = next.workers[next.workers.length - 1]!;
          update({ ...next, workers: next.workers.map((w) => w.id === added.id ? { ...w, name: newName.trim() } : w) });
          setWorkerSalary(added.id, salary);
          setNewName("");
        }}>
          <h2>Add a worker</h2>
          <p class="st-small">Give your new worker a name, station, and salary.</p>
          <div class="st-worker-add-fields">
            <label class="st-field"><span>Name</span><input class="st-input" required maxLength={80} value={newName} placeholder="Worker name" data-testid="new-worker-name" onInput={(event) => setNewName(event.currentTarget.value)} /></label>
            <label class="st-field"><span>Station</span><select class="st-input" required value={stationId} data-testid="new-worker-station" onChange={(event) => setNewStation(event.currentTarget.value)}>
              {stations.map((station) => <option key={station.boxId} value={station.boxId}>{station.name}</option>)}
            </select></label>
            <label class="st-field st-cost"><span>Hourly salary</span><span class="st-cost-input"><input class="st-input" required type="number" min={0} step="0.01" value={newSalary} data-testid="new-worker-salary" onInput={(event) => setNewSalary(event.currentTarget.value)} /><span class="unit">{econ.currency}/h</span></span></label>
            <button type="submit" class="st-btn primary" disabled={!stationId} data-testid="btn-add-worker">Add worker</button>
          </div>
          {stations.length === 0 ? <p class="st-small">Create a station in your kitchen before adding workers.</p> : null}
        </form>
      </div>
      <footer class="st-workers-foot">Changes apply as you edit.<Btn small label="Done" onClick={close} /></footer>
    </dialog>
  );
}
