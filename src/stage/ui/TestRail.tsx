/**
 * Step 3, After the change. The second run against the frozen prediction.
 * A miss is said plainly.
 */
import { formatRange } from "../../core";
import { firstRunProblem } from "../state/derive";
import { frozen, outcome, outcomeProblem, session, testPlan } from "../state/store";
import { RunControls } from "./RunRail";
import { Reveal } from "./bits";
import { ExtrapolationNote } from "./Basis";

export function TestRail() {
  const f = frozen.value;
  const plan = testPlan.value;
  const result = outcome.value;
  const problem = outcomeProblem.value;
  if (!f) return <div class="st-card"><h1>Test the prediction</h1><p class="st-note">{firstRunProblem.value ?? "Make a change in Edit (step 2) first."}</p></div>;
  const entry = plan && !plan.matched && plan.candidate ? f.candidates[plan.candidate.id] : f.judge;
  const predicted = entry?.prediction?.meanOrderTime ?? null;
  const ended = session.value?.purpose === "second" && session.value.status === "ended";
  return (
    <div class="st-card">
      <h1>{plan?.live ? "Now run it for real" : "The run after the change"}</h1>
      {plan && !plan.matched && plan.candidate ? (
        <p class="st-note" data-testid="match-note">
          No recorded run matches this exact change. Showing the recorded run for: {plan.candidate.meta.title.toLowerCase()}.
        </p>
      ) : null}
      {plan?.loadError ? <p class="st-warn">Could not load the recorded run: {plan.loadError}</p> : null}
      {entry && !entry.prediction ? <p class="st-warn">{entry.message}</p> : null}
      <RunControls
        purpose="second"
        compact
        beside={
          <div class="st-num">
            <span class="what">Predicted per order</span>
            <span class="value mid">
              <span data-testid="prediction-range">{predicted ? formatRange(predicted) : "—"}</span>
            </span>
          </div>
        }
      />
      <ExtrapolationNote prediction={entry?.prediction ?? null} />
      {ended && result ? (
        <Reveal>
          <p class="st-say" data-testid="measured-result">
            {result.headline}
          </p>
          <p class="st-say st-verdict" data-testid="verdict">
            {result.verdict}
          </p>
        </Reveal>
      ) : null}
      {ended && result?.change ? (
        <p class="st-small" data-testid="before-after">
          {result.change}
        </p>
      ) : null}
      {ended && problem ? <p class="st-warn">{problem}</p> : null}
      {!plan && problem ? <p class="st-note">{problem}</p> : null}
    </div>
  );
}
