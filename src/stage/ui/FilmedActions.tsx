/**
 * Step 3, Filmed run: what each worker is doing at the replay clock, from the
 * run's actions.jsonl, and the run's own note on what was labelled by hand.
 */
import { actionAt, actionWords, handLabelNote } from "../app/filmed";
import { base, session } from "../state/store";

export function FilmedActions() {
  const run = base.value;
  const s = session.value;
  if (!run || !run.actions) return null;
  const t = s && s.purpose === "first" ? s.t : 0;
  const boxName = (id: string) => run.setup.items.find((i) => i.boxId === id)?.name ?? id;
  const segments = run.actions.segments;
  return (
    <section class="st-filmed" aria-label="What each worker is doing" data-testid="filmed-actions">
      {run.layout.workers.map((w) => {
        const action = actionAt(segments, w.id, t);
        return (
          <p class={`st-say st-filmed-line${action ? "" : " quiet"}`} key={w.id} data-testid={`filmed-action-${w.id}`}>
            <span class="who" style={{ color: w.color }}>{w.name}</span>
            <span class="does">{actionWords(action, boxName)}</span>
          </p>
        );
      })}
      <p class="st-small" data-testid="filmed-note">{handLabelNote(run.meta)}</p>
    </section>
  );
}
