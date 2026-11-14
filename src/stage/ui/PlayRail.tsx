/**
 * Step 4. The judge changes one thing; the two numbers answer during the drag.
 */
import { formatMetres, formatRange } from "../../core";
import { addWorker, removeWorker, workersAt } from "../app/kitchen-edit";
import { changeKind } from "../app/layout-match";
import { changeDirection } from "../app/words";
import { baselineNumbers, firstRunProblem, originalLayout, playNumbers } from "../state/derive";
import { applyRehearsed, resetPlay } from "../state/flow";
import { candidates, kitchen, playLayout } from "../state/store";
import { BigNum, Btn } from "./bits";
import { ExtrapolationNote, NumbersBasis } from "./Basis";

function Staffing() {
  const k = kitchen.value;
  const layout = playLayout.value;
  if (!k || !layout) return null;
  const route = k.setup.menu.flatMap((m) => m.steps.map((s) => s.stationId));
  const stations = [...new Set(route)];
  const name = (id: string) => k.setup.items.find((i) => i.boxId === id)?.name ?? id;
  return (
    <div class="st-staff" data-testid="staffing">
      {stations.map((id) => (
        <div class="line" key={id}>
          <span>{name(id)}</span>
          <span class="st-hats">
            {layout.workers
              .filter((w) => w.stationId === id)
              .map((w) => (
                <span key={w.id} class="st-hat" style={{ background: w.color }} title={w.name} />
              ))}
          </span>
          <Btn small label="−" onClick={() => (playLayout.value = removeWorker(layout, id))} disabled={workersAt(layout, id) === 0} testId={`btn-remove-worker-${id}`} title={`Take a worker away from ${name(id)}`} />
          <Btn small label="+ worker" onClick={() => (playLayout.value = addWorker(layout, id))} testId={`btn-add-worker-${id}`} />
        </div>
      ))}
    </div>
  );
}

function Rehearsed() {
  const k = kitchen.value;
  const original = originalLayout.value;
  if (!k || !original) return null;
  const list = candidates.value.map((c) => ({ c, kind: changeKind(k.scan, k.setup, original, c.layout) }));
  const move = list.find((x) => x.kind === "move");
  const staff = list.find((x) => x.kind === "staff");
  if (!move && !staff) return null;
  return (
    <div class="st-row">
      {move ? <Btn small label={move.c.meta.title} k="M" onClick={() => applyRehearsed("m")} testId="btn-rehearsed-m" /> : null}
      {staff ? <Btn small label={staff.c.meta.title} k="W" onClick={() => applyRehearsed("w")} testId="btn-rehearsed-w" /> : null}
      <Btn small label="Reset" k="⌫" onClick={resetPlay} testId="btn-reset" />
    </div>
  );
}

export function PlayRail() {
  const n = playNumbers.value;
  const before = baselineNumbers.value;
  const problem = firstRunProblem.value;
  if (!n) return <div class="st-card"><h1>Change one thing</h1><p class="st-note">{problem}</p></div>;
  const walk = n.walking.ok ? n.walking.value.perOrderM : null;
  const walkBefore = before?.walking.ok ? before.walking.value.perOrderM : null;
  const time = n.time.ok ? n.time.value : null;
  const timeBefore = before?.time.ok ? before.time.value : null;
  const walkChanged = walk !== null && walkBefore !== null && formatMetres(walk) !== formatMetres(walkBefore);
  const timeChanged = time && timeBefore && formatRange(time.meanOrderTime) !== formatRange(timeBefore.meanOrderTime);
  const dir = time && timeBefore && timeChanged ? changeDirection(timeBefore.meanOrderTime.p50, time.meanOrderTime.p50) : null;
  return (
    <div class="st-card play">
      <h1>Change one thing</h1>
      <p class="st-lede">Drag the fridge, a station or the pickup, or add a worker.</p>
      <div class="st-nums">
        <BigNum
          what="Walking per order"
          value={walk === null ? null : formatMetres(walk)}
          cannot={n.walking.ok ? null : n.walking.message}
          was={walkChanged && walkBefore !== null ? formatMetres(walkBefore) : null}
          dir={walkChanged && walk !== null && walkBefore !== null ? (walk < walkBefore ? "less walking" : "more walking") : null}
          how="Exact, from the layout."
          testId="walking-per-order"
        />
        <BigNum
          what="Time per order"
          value={time ? formatRange(time.meanOrderTime) : null}
          cannot={n.time.ok ? null : n.time.message}
          was={timeChanged && timeBefore ? formatRange(timeBefore.meanOrderTime) : null}
          dir={dir}
          how="A range from simulated runs. Assumptions below."
          testId="time-per-order"
        />
      </div>
      {problem ? <p class="st-note">{problem}</p> : null}
      {time ? (
        <p class="st-say st-predict">
          Next run with this kitchen: orders should take <span data-testid="prediction-range">{formatRange(time.meanOrderTime)}</span> on average.
        </p>
      ) : null}
      <Staffing />
      <Rehearsed />
      <ExtrapolationNote prediction={time} />
      {time ? (
        <p class="st-small" data-testid="assumption">
          {time.assumption}
        </p>
      ) : null}
      <NumbersBasis />
    </div>
  );
}
