/**
 * The Prices and costs section of the Edit panel (key C): what each menu item
 * sells for and costs to make, wages, electricity, other running costs, and
 * how many orders come in a busy hour. Each worker can have their own wage;
 * the rest get the usual one. Profit per hour and the suggestions use these.
 * Export saves them as a JSON file; Import loads one back (see app/costs-file.ts).
 */
import { signal } from "@preact/signals";
import { formatMoney, wageOf, type Economics } from "../../core";
import { applyCosts, costsFileOf, parseCosts, serialiseCosts } from "../app/costs-file";
import { cancelSuggest } from "../state/suggest";
import { costsOpen, economics, economicsAreExamples, replaceEconomics, setEconomics, useExampleEconomics } from "../state/economics";
import { kitchen, playLayout } from "../state/store";
import { Btn } from "./bits";

/** What the last export or import did, shown under the buttons. */
const fileMessage = signal<{ readonly text: string; readonly tone: "calm" | "warn" } | null>(null);

function exportCosts(): void {
  const econ = economics.value;
  const k = kitchen.value;
  if (!econ || !k) return;
  const url = URL.createObjectURL(new Blob([serialiseCosts(costsFileOf(econ, k.setup))], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "prices-and-costs.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  fileMessage.value = { text: "Saved prices-and-costs.json.", tone: "calm" };
}

async function importCosts(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  const k = kitchen.value;
  if (!file || !k) return;
  let text: string;
  try {
    text = await file.text();
  } catch {
    fileMessage.value = { text: `Could not read ${file.name}.`, tone: "warn" };
    return;
  }
  const parsed = parseCosts(text);
  if (!parsed.ok) {
    fileMessage.value = { text: parsed.error, tone: "warn" };
    return;
  }
  const applied = applyCosts(parsed.value, k.setup);
  cancelSuggest();
  replaceEconomics(applied.economics);
  fileMessage.value =
    applied.missing.length === 0
      ? { text: `Loaded ${file.name}.`, tone: "calm" }
      : { text: `Loaded ${file.name}. It has no price for ${applied.missing.join(", ")}, so ${applied.missing.length === 1 ? "that item keeps its" : "those keep their"} example price.`, tone: "warn" };
}

/** Changing a number makes any suggestions out of date. */
function change(c: Partial<Economics>): void {
  cancelSuggest();
  setEconomics(c);
}

function Money(props: { readonly label: string; readonly value: number; readonly unit?: string; readonly step?: number; readonly testId: string; readonly onChange: (v: number) => void }) {
  return (
    <label class="st-field st-cost">
      <span>{props.label}</span>
      <span class="st-cost-input">
        <input
          type="number"
          class="st-input"
          min={0}
          step={props.step ?? 0.1}
          value={Number(props.value.toFixed(2))}
          data-testid={props.testId}
          onChange={(e) => {
            const v = Number((e.target as HTMLInputElement).value);
            if (Number.isFinite(v) && v >= 0) props.onChange(v);
          }}
        />
        {props.unit ? <span class="unit">{props.unit}</span> : null}
      </span>
    </label>
  );
}

/** One wage per worker on screen (the Play layout's workers, or the kitchen's). Unset ones follow the usual wage. */
function WorkerWages(props: { readonly econ: Economics }) {
  const k = kitchen.value;
  if (!k) return null;
  const workers = (playLayout.value ?? k.layout).workers;
  if (workers.length === 0) return null;
  const { econ } = props;
  const cur = econ.currency;
  const own = econ.wageByWorker ?? {};
  const station = (id: string) => k.setup.items.find((i) => i.boxId === id)?.name ?? id;
  const setOwn = (id: string, v: number | null) => {
    const next = { ...own };
    if (v === null) delete next[id];
    else next[id] = v;
    change({ wageByWorker: next });
  };
  return (
    <>
      <h3>Wages, per worker</h3>
      {workers.map((w) => {
        const custom = own[w.id] !== undefined;
        return (
          <div class="st-cost-row st-wage-row" key={w.id} data-testid={`worker-wage-row-${w.id}`}>
            <span class="name">
              <span class="st-hat" style={{ background: w.color }} /> {w.name} <span class="st-small">at {station(w.stationId)}</span>
            </span>
            <Money label="Wage" value={wageOf(econ, w.id)} unit={`${cur}/h`} step={0.5} testId={`cost-wage-${w.id}`} onChange={(v) => setOwn(w.id, v)} />
            {custom ? (
              <Btn small label="Use usual" onClick={() => setOwn(w.id, null)} testId={`btn-usual-wage-${w.id}`} title={`Pay ${w.name} the usual wage`} />
            ) : (
              <span class="st-small">usual wage</span>
            )}
          </div>
        );
      })}
    </>
  );
}

export function CostsSection() {
  if (!costsOpen.value) return null;
  const econ = economics.value;
  const k = kitchen.value;
  if (!econ || !k) return null;
  const cur = econ.currency;
  return (
    <section class="st-costs" data-testid="costs-section" aria-label="Prices and costs">
      <div class="st-row" style={{ justifyContent: "space-between" }}>
        <h2>Prices and costs</h2>
        <Btn small label="Close" k="Esc" onClick={() => (costsOpen.value = false)} testId="btn-close-costs" />
      </div>
      <p class="st-small">
        {economicsAreExamples.value ? "These are example numbers for a small café. Type yours: profit and the suggestions follow at once." : "Your numbers, kept in this browser."}
      </p>
      <h3>Menu</h3>
      {k.setup.menu.map((m) => {
        const p = econ.menu[m.id] ?? { price: 0, ingredients: 0 };
        return (
          <div class="st-cost-row" key={m.id}>
            <span class="name">{m.name}</span>
            <Money label="Price" value={p.price} unit={cur} testId={`cost-price-${m.id}`} onChange={(v) => change({ menu: { [m.id]: { ...p, price: v } } })} />
            <Money label="Ingredients" value={p.ingredients} unit={cur} testId={`cost-ingredients-${m.id}`} onChange={(v) => change({ menu: { [m.id]: { ...p, ingredients: v } } })} />
            <span class="st-small">{formatMoney(p.price - p.ingredients, cur)} an order</span>
          </div>
        );
      })}
      <h3>Running costs, per hour</h3>
      <div class="st-cost-grid">
        <Money label="Usual wage per worker" value={econ.wagePerHour} unit={`${cur}/h`} step={0.5} testId="cost-wage" onChange={(v) => change({ wagePerHour: v })} />
        <Money label="Electricity" value={econ.electricityPerHour} unit={`${cur}/h`} testId="cost-electricity" onChange={(v) => change({ electricityPerHour: v })} />
        <Money label="Rent and other" value={econ.otherPerHour} unit={`${cur}/h`} step={0.5} testId="cost-other" onChange={(v) => change({ otherPerHour: v })} />
      </div>
      <WorkerWages econ={econ} />
      <h3>A busy hour</h3>
      <div class="st-cost-grid">
        <Money label="Orders that come in" value={econ.demandPerHour} unit="per hour" step={5} testId="cost-demand" onChange={(v) => change({ demandPerHour: Math.round(v) })} />
        <label class="st-field st-cost">
          <span>Currency</span>
          <input
            type="text"
            class="st-input"
            maxLength={4}
            value={cur}
            data-testid="cost-currency"
            onChange={(e) => change({ currency: (e.target as HTMLInputElement).value.trim() || "$" })}
          />
        </label>
      </div>
      <p class="st-small">
        The kitchen sells the orders that come in, up to as many as it can make; how fast it makes them comes from the measured run. Each worker is paid for the
        whole hour, at their own wage if you set one and the usual wage otherwise; workers added in Play start on the usual wage. The example demand is the pace of the recorded run's orders.
      </p>
      <div class="st-row">
        <Btn small label="Export" onClick={exportCosts} testId="btn-export-costs" title="Save these numbers as a file" />
        <label class="st-btn small" title="Load numbers from a file exported here">
          Import
          <input type="file" accept="application/json,.json" hidden data-testid="input-import-costs" onChange={(e) => void importCosts(e)} />
        </label>
        <Btn
          small
          label="Use the example numbers"
          onClick={() => {
            cancelSuggest();
            useExampleEconomics();
            fileMessage.value = null;
          }}
          disabled={economicsAreExamples.value}
          testId="btn-example-costs"
        />
      </div>
      {fileMessage.value ? (
        <p class={fileMessage.value.tone === "warn" ? "st-small st-warn" : "st-small"} data-testid="costs-file-message">
          {fileMessage.value.text}
        </p>
      ) : null}
    </section>
  );
}
