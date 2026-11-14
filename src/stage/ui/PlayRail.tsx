/**
 * Setup controls for the kitchen layout, workers, and costs.
 */
import { formatMoney, formatSeconds, type ProfitEstimate } from "../../core";
import type { OptimizeResult } from "../app/optimize";
import { calibration } from "../state/derive";
import { costsOpen, economics, workersOpen } from "../state/economics";
import { applyOptimized, optimizeState, startOptimize, undoOptimized } from "../state/optimize";
import { resetPlay } from "../state/flow";
import { kitchen, playLayout, selectedId } from "../state/store";
import { Btn } from "./bits";
import { CostsSection } from "./CostsSection";
import { ItemPanel } from "./ItemPanel";

/** Searches for the most profitable kitchen; pressing again while it searches stops it. */
function OptimizeButton() {
  const st = optimizeState.value;
  const cal = calibration.value;
  const running = st.kind === "running";
  return (
    <Btn
      small
      kind={running ? "on" : "plain"}
      label={running ? `Stop (${Math.round(st.fraction * 100)}%)` : "Optimize"}
      k="A"
      onClick={startOptimize}
      disabled={!(cal && cal.ok) && !running}
      testId="btn-optimize"
      title="Find the most profitable kitchen: where the unlocked equipment stands, how many people work, and at which station"
    />
  );
}

/** The quick changes: workers, the optimizer, costs and reset. */
function Rehearsed() {
  const k = kitchen.value;
  if (!k) return null;
  return (
    <div class="st-row">
      <Btn small label="Workers" k="W" kind={workersOpen.value ? "on" : "plain"} onClick={() => (workersOpen.value = !workersOpen.value)} testId="btn-workers" />
      <OptimizeButton />
      <Btn small label="Costs" title="Prices and costs" k="C" onClick={() => (costsOpen.value = !costsOpen.value)} testId="btn-costs" />
      <Btn small label="Reset" k="⌫" onClick={resetPlay} testId="btn-reset" />
    </div>
  );
}

function list(words: readonly string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** The optimizer's changes in words, one per line: boxes, then people. */
export function describePlan(r: Extract<OptimizeResult, { ok: true }>, name: (boxId: string) => string): readonly string[] {
  const out: string[] = [];
  if (r.moved.length > 0) out.push(`Move ${list(r.moved.map(name))}`);
  for (const m of r.reassigned) out.push(`Move ${m.worker.name} from ${name(m.from)} to ${name(m.to)}`);
  const hiredAt = new Map<string, number>();
  for (const w of r.hired) hiredAt.set(w.stationId, (hiredAt.get(w.stationId) ?? 0) + 1);
  for (const [stationId, n] of hiredAt) out.push(n === 1 ? `Add a worker at ${name(stationId)}` : `Add ${n} workers at ${name(stationId)}`);
  for (const w of r.removed) out.push(`Take ${w.name} off ${name(w.stationId)}: the kitchen sells as much without them`);
  return out;
}

function Fact(props: { readonly what: string; readonly before: string | null; readonly after: string; readonly note?: string; readonly testId: string }) {
  const same = props.before === null || props.before === props.after;
  return (
    <div class="st-plan-fact">
      <span class="what">{props.what}</span>
      <span class="value" data-testid={props.testId}>
        {same ? null : <span class="was">{props.before}</span>}
        {same ? null : <span aria-hidden="true"> → </span>}
        <span class="now">{props.after}</span>
        {props.note ? <span class="note"> {props.note}</span> : null}
      </span>
    </div>
  );
}

const perHour = (p: ProfitEstimate | null) => (p ? String(Math.round(p.capacityPerHour.p50)) : null);

function Plan() {
  const st = optimizeState.value;
  const econ = economics.value;
  const k = kitchen.value;
  if (!econ || !k) return null;
  if (st.kind === "running") {
    return (
      <p class="st-small" data-testid="optimize-progress">
        Trying teams and arrangements of the unlocked equipment…
      </p>
    );
  }
  if (st.kind === "failed") return <p class="st-note" data-testid="optimize-result">{st.reason}</p>;
  if (st.kind !== "done") return null;
  const { result: r, start, profitBefore, profitAfter } = st.plan;
  if (!r.changed) {
    return (
      <p class="st-small" data-testid="optimize-result">
        No more profitable kitchen found with this equipment. To try other equipment, add it (right-click the floor) and optimize again.
      </p>
    );
  }
  const name = (id: string) => k.setup.items.find((i) => i.boxId === id)?.name ?? id;
  const money = (p: ProfitEstimate | null) => (p ? formatMoney(Math.round(p.profitPerHour.p50), econ.currency) : null);
  const gain = profitBefore && profitAfter ? Math.round(profitAfter.profitPerHour.p50) - Math.round(profitBefore.profitPerHour.p50) : null;
  const on = playLayout.value === r.layout;
  const steps = describePlan(r, name);
  return (
    <section class={`st-plan${on ? " on" : ""}`} data-testid="optimize-result" aria-label="Optimized kitchen">
      <h2>Most profitable kitchen found</h2>
      <div class="st-plan-facts">
        {profitAfter ? (
          <Fact
            what="Profit per hour"
            before={money(profitBefore)}
            after={money(profitAfter) ?? ""}
            note={gain !== null && gain !== 0 ? `(${gain > 0 ? "+" : "−"}${formatMoney(Math.abs(gain), econ.currency)})` : undefined}
            testId="plan-profit"
          />
        ) : null}
        {profitAfter ? <Fact what="Orders it can make per hour" before={perHour(profitBefore)} after={perHour(profitAfter) ?? ""} testId="plan-capacity" /> : null}
        <Fact what="Workers" before={String(start.workers.length)} after={String(r.layout.workers.length)} testId="plan-workers" />
        <Fact what="Time per order" before={r.before ? formatSeconds(r.before.orderTimeS) : null} after={formatSeconds(r.after.orderTimeS)} testId="plan-order-time" />
      </div>
      <ul class="st-plan-steps" data-testid="plan-steps">
        {steps.map((text) => (
          <li key={text}>{text}</li>
        ))}
      </ul>
      {profitAfter && profitAfter.limitedBy === "demand" ? <p class="st-small">This kitchen keeps up with every order that comes in, so more people would only add wages.</p> : null}
      {r.hired.length > 0 ? <p class="st-small">A new worker is paid the default hourly salary ({formatMoney(econ.wagePerHour, econ.currency)}).</p> : null}
      <div class="st-row">
        <Btn small kind={on ? "on" : "primary"} label={on ? "Showing" : "Apply"} onClick={applyOptimized} testId="btn-apply-plan" />
        {on ? <Btn small label="Back to before" onClick={undoOptimized} testId="btn-undo-plan" /> : null}
      </div>
    </section>
  );
}

export function PlayRail() {
  const id = selectedId.value;
  if (id && kitchen.value) return <ItemPanel boxId={id} />;
  return (
    <div class="st-card play">
      <Rehearsed />
      <CostsSection />
      <Plan />
    </div>
  );
}
