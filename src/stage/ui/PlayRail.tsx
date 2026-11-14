/**
 * Step 2, Edit. Profit per hour on top; under it, ideas that would raise it
 * (the rehearsed changes, then whatever Find more turns up), each one click to
 * try. Workers per station and prices and costs sit below for fine-tuning.
 */
import { formatMoney, formatMoneyRange, type Layout } from "../../core";
import type { Suggestion } from "../app/suggest";
import { addWorker, removeWorker, workersAt } from "../app/kitchen-edit";
import { changeKind, layoutsMatch } from "../app/layout-match";
import { calibration, firstRunProblem, originalLayout, playNumbers } from "../state/derive";
import { baselineProfit, costsOpen, economics, playProfit, profitFor } from "../state/economics";
import { applySuggestion, startSuggest, suggestState, undoSuggestion } from "../state/suggest";
import { applyRehearsed, resetPlay } from "../state/flow";
import { candidates, kitchen, playLayout } from "../state/store";
import { BigNum, Btn, Key } from "./bits";
import { CostsSection } from "./CostsSection";

function itemName(id: string): string {
  return kitchen.value?.setup.items.find((i) => i.boxId === id)?.name ?? id;
}

function names(ids: readonly string[]): string {
  const list = ids.map(itemName);
  if (list.length <= 1) return list.join("");
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

/** A suggestion in words: "Add a worker at Espresso machine and move Finish". */
function describe(s: Suggestion): string {
  const staff = s.staff ? (s.staff.delta > 0 ? `Add a worker at ${itemName(s.staff.stationId)}` : `Take a worker off ${itemName(s.staff.stationId)}`) : "";
  const move = s.moved.length > 0 ? `${staff ? "move" : "Move"} ${names(s.moved)}` : "";
  return [staff, move].filter(Boolean).join(" and ");
}

/** "+$479 an hour", or "same profit" when it hardly moves. */
function gainText(gain: number | null, sameNote: string): string {
  const cur = economics.value?.currency ?? "$";
  if (gain === null) return "";
  if (Math.abs(gain) < 1) return sameNote;
  return `${gain > 0 ? "+" : "−"}${formatMoney(Math.abs(gain), cur)}/h`;
}

/** The headline: profit per hour and what it is made of. */
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

/** One idea: the whole row is the button; the one on the board is marked. */
function Idea(props: { readonly text: string; readonly gain: string; readonly on: boolean; readonly k?: string; readonly onClick: () => void; readonly testId: string; readonly rowTestId?: string; readonly title?: string }) {
  return (
    <button
      type="button"
      class={`st-idea${props.on ? " on" : ""}`}
      aria-pressed={props.on}
      onClick={props.onClick}
      data-testid={props.testId}
      title={props.title}
    >
      <span class="mark" aria-hidden="true" />
      <span class="text" data-testid={props.rowTestId}>{props.text}</span>
      <span class="gain">{props.gain}</span>
      {props.k ? <Key k={props.k} /> : null}
    </button>
  );
}

/** The rehearsed changes (keys M and W), each with what it would do to profit. */
function rehearsedIdeas(): { readonly key: "m" | "w"; readonly title: string; readonly layout: Layout; readonly gain: number | null; readonly faster: boolean }[] {
  const k = kitchen.value;
  const original = originalLayout.value;
  const before = baselineProfit.value;
  if (!k || !original) return [];
  const out: { key: "m" | "w"; title: string; layout: Layout; gain: number | null; faster: boolean }[] = [];
  for (const key of ["m", "w"] as const) {
    const want = key === "m" ? "move" : "staff";
    const c = candidates.value.find((x) => changeKind(k.scan, k.setup, original, x.layout) === want);
    if (!c) continue;
    const p = profitFor(c.layout);
    const gain = p && p.ok && before && before.ok ? p.value.profitPerHour.p50 - before.value.profitPerHour.p50 : null;
    // When the kitchen already keeps up with demand, a faster layout sells no more; say it is faster.
    const faster = !!(p && p.ok && before && before.ok && p.value.capacityPerHour.p50 > before.value.capacityPerHour.p50 + 1);
    out.push({ key, title: c.meta.title, layout: c.layout, gain, faster });
  }
  return out;
}

function Ideas() {
  const st = suggestState.value;
  const cal = calibration.value;
  const onBoard = playLayout.value;
  const running = st.kind === "running";
  const rehearsed = rehearsedIdeas();
  const k = kitchen.value;
  // A found idea that is the same as a rehearsed one is shown once, as the rehearsed one.
  const found = st.kind === "done" && k ? st.list.filter((x) => !rehearsed.some((r) => layoutsMatch(k.scan, k.setup, r.layout, x.s.layout))) : [];
  const showingFound = found.some((x) => x.s.layout === onBoard);
  return (
    <section class="st-ideas" aria-label="Ideas">
      <div class="st-ideas-head">
        <h2>Ideas</h2>
        <Btn
          small
          kind={running ? "on" : "primary"}
          label={running ? `Stop (${Math.round(st.fraction * 100)}%)` : st.kind === "done" ? "Search again" : "Find more"}
          k="A"
          onClick={startSuggest}
          disabled={!(cal && cal.ok) && !running}
          testId="btn-suggest"
          title="Try more or fewer workers and moving the unlocked boxes, ranked by profit per hour"
        />
      </div>
      <div class="st-idea-list">
        {rehearsed.map((r) => (
          <Idea
            key={r.key}
            text={r.title}
            gain={gainText(r.gain, r.faster ? "same profit, faster" : "same profit")}
            on={onBoard === r.layout}
            k={r.key.toUpperCase()}
            onClick={() => applyRehearsed(r.key)}
            testId={`btn-rehearsed-${r.key}`}
            title="The change rehearsed for the demo: there is a recorded run of it"
          />
        ))}
        {st.kind === "done" ? (
          <div class="st-suggestions" data-testid="suggest-result">
            {found.length === 0 ? <p class="st-small">{rehearsed.length > 0 ? "Nothing better than these found." : "No better change found."}</p> : null}
            {found.map((x, i) => (
              <div key={x.s.id} data-testid={`suggestion-${i}`}>
                <Idea
                  text={describe(x.s)}
                  gain={gainText(x.gainPerHour, "same profit, shorter waits")}
                  on={onBoard === x.s.layout}
                  onClick={() => applySuggestion(x.s)}
                  testId={`btn-try-suggestion-${i}`}
                />
              </div>
            ))}
          </div>
        ) : null}
        {st.kind === "failed" ? (
          <p class="st-note" data-testid="suggest-result">
            {st.reason}
          </p>
        ) : null}
        {running ? <p class="st-small">Trying staffing changes and new spots for the unlocked boxes…</p> : null}
        {st.kind === "idle" && rehearsed.length === 0 ? <p class="st-small">Press Find more to search for changes that make more profit.</p> : null}
      </div>
      {showingFound ? (
        <button type="button" class="st-link st-small" onClick={undoSuggestion} data-testid="btn-undo-suggestion">
          Back to before
        </button>
      ) : null}
    </section>
  );
}

/** Workers per station: a − / + stepper, the hats show who is there. */
function Staffing() {
  const k = kitchen.value;
  const layout = playLayout.value;
  if (!k || !layout) return null;
  const stations = [...new Set(k.setup.menu.flatMap((m) => m.steps.map((s) => s.stationId)))];
  return (
    <section class="st-staff" data-testid="staffing" aria-label="Workers">
      <h2>Workers</h2>
      {stations.map((id) => (
        <div class="line" key={id}>
          <span class="name">{itemName(id)}</span>
          <span class="st-hats">
            {layout.workers
              .filter((w) => w.stationId === id)
              .map((w) => (
                <span key={w.id} class="st-hat" style={{ background: w.color }} title={w.name} />
              ))}
          </span>
          <span class="st-stepper">
            <button
              type="button"
              onClick={() => (playLayout.value = removeWorker(layout, id))}
              disabled={workersAt(layout, id) === 0}
              data-testid={`btn-remove-worker-${id}`}
              title={`Take a worker away from ${itemName(id)}`}
              aria-label={`Take a worker away from ${itemName(id)}`}
            >
              −
            </button>
            <button
              type="button"
              onClick={() => (playLayout.value = addWorker(layout, id))}
              data-testid={`btn-add-worker-${id}`}
              title={`Add a worker at ${itemName(id)}`}
              aria-label={`Add a worker at ${itemName(id)}`}
            >
              +
            </button>
          </span>
        </div>
      ))}
    </section>
  );
}

export function PlayRail() {
  const n = playNumbers.value;
  const problem = firstRunProblem.value;
  if (!n) return <div class="st-card"><h1>Change one thing</h1><p class="st-note">{problem}</p></div>;
  return (
    <div class="st-card play">
      <Money />
      {problem ? <p class="st-note">{problem}</p> : null}
      <Ideas />
      <Staffing />
      <div class="st-row st-play-foot">
        <Btn small label={costsOpen.value ? "Hide prices and costs" : "Prices and costs"} k="C" onClick={() => (costsOpen.value = !costsOpen.value)} testId="btn-costs" />
        <Btn small label="Reset" k="⌫" onClick={resetPlay} testId="btn-reset" title="Put everything back as it was in the first run" />
      </div>
      <CostsSection />
    </div>
  );
}
