import { economics, setWorkerSalary, workersOpen } from "../state/economics";
import { cancelSuggest } from "../state/suggest";
import { kitchen, playLayout } from "../state/store";
import { Btn } from "./bits";

export function WorkersSection() {
  const k = kitchen.value;
  const layout = playLayout.value ?? k?.layout;
  const econ = economics.value;
  if (!workersOpen.value || !k || !layout || !econ) return null;
  return (
    <section class="st-workers" data-testid="workers-section" aria-label="Workers and salaries">
      <div class="st-row" style={{ justifyContent: "space-between" }}>
        <h2>Workers</h2>
        <Btn small label="Close" k="Esc" onClick={() => (workersOpen.value = false)} testId="btn-close-workers" />
      </div>
      {layout.workers.length === 0 ? <p class="st-small">No workers yet. Add a worker at a station below.</p> : null}
      {layout.workers.map((worker) => (
        <div class="st-worker-row" key={worker.id} data-testid={`worker-${worker.id}`}>
          <div class="st-worker-name">
            <span class="st-hat" style={{ background: worker.color }} aria-hidden="true" />
            <span>{worker.name}<small>{k.setup.items.find((item) => item.boxId === worker.stationId)?.name ?? worker.stationId}</small></span>
          </div>
          <label class="st-field st-cost">
            <span>Hourly salary</span>
            <span class="st-cost-input">
              <input
                class="st-input"
                type="number"
                min={0}
                step="0.01"
                value={econ.workerWages?.[worker.id] ?? econ.wagePerHour}
                aria-label={`Hourly salary for ${worker.name}`}
                data-testid={`worker-salary-${worker.id}`}
                onChange={(event) => {
                  const input = event.currentTarget;
                  if (input.value.trim() && input.validity.valid && Number.isFinite(input.valueAsNumber)) {
                    cancelSuggest();
                    setWorkerSalary(worker.id, input.valueAsNumber);
                  } else {
                    input.value = String(econ.workerWages?.[worker.id] ?? econ.wagePerHour);
                  }
                }}
              />
              <span class="unit">{econ.currency}/h</span>
            </span>
          </label>
        </div>
      ))}
    </section>
  );
}
