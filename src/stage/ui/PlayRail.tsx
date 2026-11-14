/**
 * Step 4. The judge changes one thing; the two numbers answer during the drag,
 * and so does profit per hour. Suggestions rank changes by that profit.
 */
import { formatMetres, formatMoney, formatMoneyRange, formatRange, formatSeconds } from "../../core";
import type { Suggestion } from "../app/suggest";
import { addWorker, removeWorker, workersAt } from "../app/kitchen-edit";
import { changeKind } from "../app/layout-match";
import { changeDirection } from "../app/words";
import { baselineNumbers, calibration, firstRunProblem, originalLayout, playNumbers } from "../state/derive";
import { baselineProfit, costsOpen, economics, economicsAreExamples, playProfit } from "../state/economics";
import { applySuggestion, startSuggest, suggestState, undoSuggestion } from "../state/suggest";
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
  return (
    <div class="st-row">
      {move ? <Btn small label={move.c.meta.title} k="M" onClick={() => applyRehearsed("m")} testId="btn-rehearsed-m" /> : null}
      {staff ? <Btn small label={staff.c.meta.title} k="W" onClick={() => applyRehearsed("w")} testId="btn-rehearsed-w" /> : null}
      <Btn small label="Reset" k="⌫" onClick={resetPlay} testId="btn-reset" />
    </div>
  );
}

function names(ids: readonly string[]): string {
  const k = kitchen.value;
  const list = ids.map((id) => k?.setup.items.find((i) => i.boxId === id)?.name ?? id);
  if (list.length <= 1) return list.join("");
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

/** A suggestion in words: "Add a worker at Espresso machine and move Finish". */
function describe(s: Suggestion): string {
  const k = kitchen.value;
  const name = (id: string) => k?.setup.items.find((i) => i.boxId === id)?.name ?? id;
  const staff = s.staff ? (s.staff.delta > 0 ? `Add a worker at ${name(s.staff.stationId)}` : `Take a worker off ${name(s.staff.stationId)}`) : "";
  const move = s.moved.length > 0 ? `${staff ? "move" : "Move"} ${names(s.moved)}` : "";
  return [staff, move].filter(Boolean).join(" and ");
}

/** Profit per hour, the buttons that change it, and the suggestions. */
function Money() {
  const p = playProfit.value;
  const before = baselineProfit.value;
  const econ = economics.value;
  const st = suggestState.value;
  const cal = calibration.value;
  if (!econ || !p) return null;
  const cur = econ.currency;
  const value = p.ok ? p.value : null;
  const was = before && before.ok && value && formatMoneyRange(before.value.profitPerHour, cur) !== formatMoneyRange(value.profitPerHour, cur) ? formatMoneyRange(before.value.profitPerHour, cur) : null;
  const running = st.kind === "running";
  return (
    <div class="st-money" data-testid="money">
      <div class="st-money-line">
        <span class="what">Profit per hour</span>
        {value ? (
          <span class="value" data-testid="profit-per-hour">
            {formatMoneyRange(value.profitPerHour, cur)}
          </span>
        ) : (
          <span class="st-small" data-testid="profit-per-hour-cannot">{p.ok ? "" : p.message}</span>
        )}
        {was ? <span class="was" data-testid="profit-per-hour-before">{was}</span> : null}
      </div>
      {value ? (
        <p class="st-small" data-testid="profit-basis">
          {value.limitedBy === "capacity"
            ? `Sells all it can make: ${Math.round(value.salesPerHour.p50)} of the ${Math.round(econ.demandPerHour)} orders an hour that come in.`
            : `Sells all ${Math.round(econ.demandPerHour)} orders an hour that come in; it could make ${Math.round(value.capacityPerHour.p50)}.`}{" "}
          {formatMoney(value.marginPerOrder, cur)} an order after ingredients, less {formatMoney(value.wagesPerHour, cur)} wages ({value.workers} people) and{" "}
          {formatMoney(value.fixedPerHour, cur)} running costs.
          {economicsAreExamples.value ? " Example prices and costs: press C to set yours." : ""}
        </p>
      ) : null}
      <div class="st-row">
        <Btn
          small
          kind={running ? "on" : "plain"}
          label={running ? `Stop (${Math.round(st.fraction * 100)}%)` : "Suggest changes"}
          k="A"
          onClick={startSuggest}
          disabled={!(cal && cal.ok) && !running}
          testId="btn-suggest"
          title="Try more or fewer workers and moving the unlocked boxes, ranked by profit per hour"
        />
        <Btn small label="Prices and costs" k="C" onClick={() => (costsOpen.value = !costsOpen.value)} testId="btn-costs" />
      </div>
      <Suggestions />
    </div>
  );
}

function Suggestions() {
  const st = suggestState.value;
  const econ = economics.value;
  if (!econ) return null;
  if (st.kind === "running") {
    return (
      <p class="st-small" data-testid="suggest-progress">
        Trying a worker more or less at each station, and every spot and turn for each unlocked box.
      </p>
    );
  }
  if (st.kind === "failed") return <p class="st-note" data-testid="suggest-result">{st.reason}</p>;
  if (st.kind !== "done") return null;
  if (st.list.length === 0) {
    return (
      <p class="st-small" data-testid="suggest-result">
        Nothing we tried makes more profit than this layout, or makes orders quicker.
      </p>
    );
  }
  const onBoard = playLayout.value;
  return (
    <div class="st-suggestions" data-testid="suggest-result">
      {st.list.map((x, i) => {
        const on = onBoard === x.s.layout;
        const gain = Math.abs(x.gainPerHour) < 1
          ? `same profit, orders ${formatSeconds(x.waitAfterS)} not ${formatSeconds(x.waitBeforeS)}`
          : `${x.gainPerHour > 0 ? "+" : ""}${formatMoney(x.gainPerHour, econ.currency)} an hour`;
        return (
          <div class={`st-suggestion${on ? " on" : ""}`} key={x.s.id} data-testid={`suggestion-${i}`}>
            <Btn small kind={on ? "on" : "plain"} label={on ? "Showing" : "Try"} onClick={() => applySuggestion(x.s)} testId={`btn-try-suggestion-${i}`} />
            <span class="text">{describe(x.s)}</span>
            <span class="gain">{gain}</span>
          </div>
        );
      })}
      <p class="st-small">
        Best first. Moves keep locked boxes where they are and know nothing of customers, doors or sockets: lock what must stay in Scan. A second worker at a station is assumed
        not to get in the first one's way.{" "}
        {st.list.some((x) => x.s.layout === onBoard) ? (
          <button type="button" class="st-link" onClick={undoSuggestion} data-testid="btn-undo-suggestion">
            Back to before
          </button>
        ) : null}
      </p>
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
      <Money />
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
