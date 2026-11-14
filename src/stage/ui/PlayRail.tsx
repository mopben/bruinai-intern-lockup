/**
 * Step 2, Edit. Adjust the layout and staffing, then compare walking and order time.
 */
import { formatMetres, formatRange, formatSeconds } from "../../core";
import type { Suggestion } from "../app/suggest";
import { clampOrders, MAX_ORDERS, MIN_ORDERS } from "../app/orders";
import { changeDirection } from "../app/words";
import { baselineNumbers, calibration, firstRunProblem, playNumbers } from "../state/derive";
import { costsOpen, economics, workersOpen } from "../state/economics";
import { applySuggestion, startSuggest, suggestState, undoSuggestion } from "../state/suggest";
import { resetPlay } from "../state/flow";
import { kitchen, orderCount, playLayout, selectedId } from "../state/store";
import { BigNum, Btn } from "./bits";
import { CostsSection } from "./CostsSection";
import { ExtrapolationNote } from "./Basis";
import { ItemPanel } from "./ItemPanel";

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
      title="Try more or fewer workers and moving the unlocked boxes, to improve the kitchen"
    />
  );
}

/** The quick changes: the rehearsed ones, suggestions, costs and reset. */
function Rehearsed() {
  const k = kitchen.value;
  if (!k) return null;
  return (
    <div class="st-row">
      <Btn small label="Workers" k="W" kind={workersOpen.value ? "on" : "plain"} onClick={() => (workersOpen.value = !workersOpen.value)} testId="btn-workers" />
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
        const gain = `Orders ${formatSeconds(x.waitBeforeS)} → ${formatSeconds(x.waitAfterS)}`;
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
        <Rehearsed />

        <p class="st-note">{problem}</p>
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
      <Orders />
      <Suggestions />
      <ExtrapolationNote prediction={time} />
    </div>
  );
}
