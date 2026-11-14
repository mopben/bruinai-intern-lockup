/**
 * The Prices and costs section of the Edit panel (key C): what each menu item
 * sells for and costs to make, wages, electricity, other running costs, and
 * how many orders come in a busy hour. Profit per hour and the suggestions
 * use these.
 */
import { formatMoney, type Economics } from "../../core";
import { cancelSuggest } from "../state/suggest";
import { costsOpen, economics, economicsAreExamples, setEconomics, useExampleEconomics } from "../state/economics";
import { kitchen } from "../state/store";
import { Btn } from "./bits";

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
        <Money label="Wage per worker" value={econ.wagePerHour} unit={`${cur}/h`} step={0.5} testId="cost-wage" onChange={(v) => change({ wagePerHour: v })} />
        <Money label="Electricity" value={econ.electricityPerHour} unit={`${cur}/h`} testId="cost-electricity" onChange={(v) => change({ electricityPerHour: v })} />
        <Money label="Rent and other" value={econ.otherPerHour} unit={`${cur}/h`} step={0.5} testId="cost-other" onChange={(v) => change({ otherPerHour: v })} />
      </div>
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
        whole hour. The example demand is the pace of the recorded run's orders.
      </p>
      <div class="st-row">
        <Btn small label="Use the example numbers" onClick={() => { cancelSuggest(); useExampleEconomics(); }} disabled={economicsAreExamples.value} testId="btn-example-costs" />
      </div>
    </section>
  );
}
