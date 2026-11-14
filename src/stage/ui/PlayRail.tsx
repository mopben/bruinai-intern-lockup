/**
 * Step 2, Edit. The judge changes one thing; the two numbers answer during the drag,
 * and so does profit per hour. Suggestions rank changes by that profit.
 */
import { formatMetres, formatMoney, formatMoneyRange, formatRange, formatSeconds } from "../../core";
import type { Suggestion } from "../app/suggest";
import { addWorker, removeWorker, workersAt } from "../app/kitchen-edit";
import { changeKind } from "../app/layout-match";
import { clampOrders, MAX_ORDERS, MIN_ORDERS } from "../app/orders";
import { changeDirection } from "../app/words";
import { baselineNumbers, calibration, firstRunProblem, originalLayout, playNumbers } from "../state/derive";
import { baselineProfit, costsOpen, economics, playProfit } from "../state/economics";
import { applySuggestion, startSuggest, suggestState, undoSuggestion } from "../state/suggest";
import { applyRehearsed, resetPlay } from "../state/flow";
import { candidates, kitchen, orderCount, playLayout, selectedId } from "../state/store";
import { BigNum, Btn } from "./bits";
import { CostsSection } from "./CostsSection";
import { ExtrapolationNote } from "./Basis";
import { ItemPanel } from "./ItemPanel";
import { RouteEditor } from "./RouteEditor";

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

/** Lists changes ranked by profit; pressing again while it searches stops it. */
function SuggestButton() {
  const st = suggestState.value;
  const cal = calibration.value;
  const running = st.kind === "running";
  return (
    <Btn
      small
      kind={running ? "on" : "plain"}
      label={running ? `Stop (${Math.round(st.fraction * 100)}%)` : "Suggest"}
      k="A"
      onClick={startSuggest}
      disabled={!(cal && cal.ok) && !running}
      testId="btn-suggest"
      title="Try more or fewer workers and moving the unlocked boxes, ranked by profit per hour"
    />
  );
}

/** The quick changes: the rehearsed ones, suggestions, costs and reset. */
function Rehearsed() {
  const k = kitchen.value;
  const original = originalLayout.value;
  if (!k || !original) return null;
  const list = candidates.value.map((c) => ({ c, kind: changeKind(k.scan, k.setup, original, c.layout) }));
  const move = list.find((x) => x.kind === "move");
  const staff = list.find((x) => x.kind === "staff");
  return (
    <div class="st-row">
      {move ? <Btn small label="Move fridge" title={move.c.meta.title} k="M" onClick={() => applyRehearsed("m")} testId="btn-rehearsed-m" /> : null}
      {staff ? <Btn small label="Add worker" title={staff.c.meta.title} k="W" onClick={() => applyRehearsed("w")} testId="btn-rehearsed-w" /> : null}
      <SuggestButton />
      <Btn small label="Costs" title="Prices and costs" k="C" onClick={() => (costsOpen.value = !costsOpen.value)} testId="btn-costs" />
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

/** The headline: profit per hour, what it is made of, and the buttons that change it. */
function Money() {
  const p = playProfit.value;
  const before = baselineProfit.value;
  const econ = economics.value;
  if (!econ || !p) return null;
  const cur = econ.currency;
  const value = p.ok ? p.value : null;
  const was =
    before && before.ok && value && formatMoneyRange(before.value.profitPerHour, cur) !== formatMoneyRange(value.profitPerHour, cur) ? before.value : null;
  const dir = was && value ? (value.profitPerHour.p50 > was.profitPerHour.p50 ? "more profit" : "less profit") : null;
  return (
    <div class="st-money" data-testid="money">
      <BigNum
        what="Profit per hour"
        value={value ? formatMoneyRange(value.profitPerHour, cur) : null}
        cannot={p.ok ? null : p.message}
        was={was ? formatMoneyRange(was.profitPerHour, cur) : null}
        dir={dir}
        how={
          value ? (
            <span data-testid="profit-basis">
              {value.limitedBy === "capacity"
                ? `Sells ${Math.round(value.salesPerHour.p50)} of ${Math.round(econ.demandPerHour)} orders an hour (all it can make)`
                : `Sells all ${Math.round(econ.demandPerHour)} orders an hour (could make ${Math.round(value.capacityPerHour.p50)})`}
              {`: ${formatMoney(value.marginPerOrder, cur)} each after ingredients, less ${formatMoney(value.wagesPerHour, cur)} wages and ${formatMoney(value.fixedPerHour, cur)} running costs.`}
            </span>
          ) : (
            ""
          )
        }
        testId="profit-per-hour"
      />
    </div>
  );
}

function Suggestions() {
  const st = suggestState.value;
  const econ = economics.value;
  if (!econ) return null;
  if (st.kind === "running") return null;
  if (st.kind === "failed") return <p class="st-note" data-testid="suggest-result">{st.reason}</p>;
  if (st.kind !== "done") return null;
  if (st.list.length === 0) {
    return (
      <p class="st-small" data-testid="suggest-result">
        No better change found.
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
      {st.list.some((x) => x.s.layout === onBoard) ? (
        <p class="st-small">
          <button type="button" class="st-link" onClick={undoSuggestion} data-testid="btn-undo-suggestion">
            Back to before
          </button>
        </p>
      ) : null}
    </div>
  );
}

function Orders() {
  const schedule = kitchen.value?.setup.schedule.orders;
  if (!schedule) return null;
  const count = orderCount.value ?? schedule.length;
  const setCount = (n: number) => {
    const next = clampOrders(n);
    orderCount.value = next === schedule.length ? null : next;
  };
  return (
    <div class="st-row" aria-label="Orders in the rush">
      <span>Orders in the rush</span>
      <Btn small label="−" onClick={() => setCount(count - 1)} disabled={count <= MIN_ORDERS} testId="btn-orders-less" />
      <span data-testid="orders-count">{count}</span>
      <Btn small label="+" onClick={() => setCount(count + 1)} disabled={count >= MAX_ORDERS} testId="btn-orders-more" />
      {count !== schedule.length ? <Btn small label="Reset" onClick={() => (orderCount.value = null)} testId="btn-orders-reset" /> : null}
    </div>
  );
}

export function PlayRail() {
  const n = playNumbers.value;
  const before = baselineNumbers.value;
  const problem = firstRunProblem.value;
  const id = selectedId.value;
  if (id && kitchen.value) return <ItemPanel boxId={id} />;
  if (!n)
    return (
      <div class="st-card">
        <h1>Change one thing</h1>
        <p class="st-note">{problem}</p>
        <RouteEditor />
      </div>
    );
  const walk = n.walking.ok ? n.walking.value.perOrderM : null;
  const walkBefore = before?.walking.ok ? before.walking.value.perOrderM : null;
  const time = n.time.ok ? n.time.value : null;
  const originalCount = kitchen.value?.setup.schedule.orders.length ?? 0;
  const count = orderCount.value ?? originalCount;
  const countChanged = count !== originalCount;
  const timeBefore = before?.time.ok ? before.time.value : null;
  const walkChanged = walk !== null && walkBefore !== null && formatMetres(walk) !== formatMetres(walkBefore);
  const timeChanged = time && timeBefore && formatRange(time.meanOrderTime) !== formatRange(timeBefore.meanOrderTime);
  const dir = time && timeBefore && timeChanged ? changeDirection(timeBefore.meanOrderTime.p50, time.meanOrderTime.p50) : null;
  return (
    <div class="st-card play">
      <Money />
      <Rehearsed />
      <CostsSection />
      <div class="st-nums pair">
        <BigNum
          what="Walking per order"
          value={walk === null ? null : formatMetres(walk)}
          cannot={n.walking.ok ? null : n.walking.message}
          was={walkChanged && walkBefore !== null ? formatMetres(walkBefore) : null}
          dir={walkChanged && walk !== null && walkBefore !== null ? (walk < walkBefore ? "less walking" : "more walking") : null}
          how=""
          testId="walking-per-order"
        />
        <BigNum
          what="Time per order"
          value={time ? formatRange(time.meanOrderTime) : null}
          cannot={n.time.ok ? null : n.time.message}
          was={timeChanged && timeBefore ? formatRange(timeBefore.meanOrderTime) : null}
          dir={dir}
          how=""
          testId="time-per-order"
        />
      </div>
      {problem ? <p class="st-note">{problem}</p> : null}
      {time ? (
        <p class="st-say st-predict">
          Prediction{countChanged ? ` (${count} orders)` : ""}: <span data-testid="prediction-range">{formatRange(time.meanOrderTime)}</span>
        </p>
      ) : null}
      <RouteEditor />
      <Staffing />
      <Orders />
      <Suggestions />
      <ExtrapolationNote prediction={time} />
    </div>
  );
}
