/**
 * The kitchen normally arrives from the stage (control "kitchen" message).
 * Without a stage, the operator can load one from a recorded run.
 */
import { signal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { listFixtures, loadRunBundle, type RunListing } from "../../inputs/api";
import type { CameraStore } from "./store";

const runs = signal<readonly RunListing[]>([]);
const listError = signal<string | undefined>(undefined);

export function KitchenPicker({ store }: { readonly store: CameraStore }) {
  useEffect(() => {
    listFixtures()
      .then((r) => (runs.value = r.filter((x) => !x.error)))
      .catch((e: unknown) => (listError.value = e instanceof Error ? e.message : "Could not list recorded runs."));
  }, []);

  async function load(url: string) {
    if (!url) return;
    try {
      const b = await loadRunBundle(url);
      store.setKitchen({ scan: b.scan, setup: b.setup, layout: b.layout }, `recorded run ${b.meta.id}`);
    } catch (error) {
      store.say(error instanceof Error ? error.message : "That run could not be loaded.", "warn");
    }
  }

  const k = store.kitchen.value;
  return (
    <div class="kitchen-picker">
      <span class="small">
        Kitchen: <strong>{k ? `from ${k.from}` : "waiting for the stage…"}</strong>
      </span>
      <select aria-label="Load a kitchen from a recorded run" value="" onChange={(e) => void load((e.target as HTMLSelectElement).value)}>
        <option value="">{k ? "Use another…" : "Or load from a recorded run…"}</option>
        {runs.value.map((r) => (
          <option key={r.url} value={r.url}>
            {r.meta?.title ?? r.id}
          </option>
        ))}
      </select>
      {listError.value && <span class="small warn-text">{listError.value}</span>}
    </div>
  );
}
