/**
 * The recorded second runs, loaded whole at start-up and kept in memory, so
 * Test works even if the laptop server stops mid-demo.
 *
 * Only the Test step's run player reads these (flow.ts beginTest). The
 * prediction cannot: frozen.ts takes layouts only, and neither it nor
 * derive.ts imports this module (checked in preload.test.ts).
 */
import type { RunBundle } from "../../core";
import { loadRunBundle } from "../../inputs";

let bundles: ReadonlyMap<string, RunBundle> = new Map();

/** Loads every listed second run; a run that fails to load is simply fetched again in Test. */
export async function preloadSecondRuns(list: readonly { readonly id: string; readonly url?: string }[]): Promise<void> {
  const loaded = await Promise.all(
    list.map(async (c) => {
      try {
        return [c.id, await loadRunBundle(c.url ?? `/fixtures/${encodeURIComponent(c.id)}/`)] as const;
      } catch {
        return null;
      }
    }),
  );
  bundles = new Map(loaded.filter((x): x is readonly [string, RunBundle] => x !== null));
}

export function preloadedBundle(id: string): RunBundle | null {
  return bundles.get(id) ?? null;
}
