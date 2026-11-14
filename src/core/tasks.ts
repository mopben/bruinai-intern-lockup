/**
 * Task graphs of menu items, and the stations workers cover.
 *
 * A menu item without `tasks` is a chain: step k comes after step k-1.
 * With `tasks`, task k's position in the list is its index, so a tap's `step`
 * keeps its meaning. `steps[k]` must name the same station and storage as `tasks[k]`.
 */
import type { MenuItem, TaskDef, WorkerDef } from "./types";

export interface ResolvedTask {
  readonly index: number;
  readonly id: string;
  readonly stationId: string;
  readonly fetchFrom: readonly string[];
  /** Indices of the tasks that must be done first. Empty: starts on release. */
  readonly after: readonly number[];
  /** Index of the task this one's output goes to. null: carried to the pickup. */
  readonly next: number | null;
}

function chainTasks(item: MenuItem): readonly ResolvedTask[] {
  const n = item.steps.length;
  return item.steps.map((s, k) => ({
    index: k,
    id: `s${k}`,
    stationId: s.stationId,
    fetchFrom: s.fetchFrom ?? [],
    after: k === 0 ? [] : [k - 1],
    next: k < n - 1 ? k + 1 : null,
  }));
}

/**
 * The item's tasks with `after` as indices and `next` filled in.
 * Never throws: unknown or repeated `after` ids are dropped. Check `taskIssues` first.
 */
export function itemTasks(item: MenuItem): readonly ResolvedTask[] {
  const defs = item.tasks;
  if (!defs) return chainTasks(item);
  const indexOf = new Map<string, number>();
  defs.forEach((t, k) => {
    if (!indexOf.has(t.id)) indexOf.set(t.id, k);
  });
  const afters = defs.map((t) => [...new Set((t.after ?? []).flatMap((id) => indexOf.get(id) ?? []))]);
  return defs.map((t, k) => {
    const nextIndex = afters.findIndex((a) => a.includes(k));
    return {
      index: k,
      id: t.id,
      stationId: t.stationId,
      fetchFrom: t.fetchFrom ?? [],
      after: afters[k] ?? [],
      next: nextIndex === -1 ? null : nextIndex,
    };
  });
}

function sameList(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  const x = a ?? [];
  const y = b ?? [];
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

function stepIssues(item: MenuItem, defs: readonly TaskDef[]): string[] {
  if (defs.length !== item.steps.length) {
    return [`"${item.name}" has ${defs.length} tasks but ${item.steps.length} steps; they must match one to one.`];
  }
  return defs.flatMap((t, k) => {
    const s = item.steps[k];
    if (!s) return [];
    const out: string[] = [];
    if (s.stationId !== t.stationId) out.push(`"${item.name}" task "${t.id}" is at station "${t.stationId}", but step ${k + 1} is at "${s.stationId}".`);
    if (!sameList(s.fetchFrom, t.fetchFrom)) out.push(`"${item.name}" task "${t.id}" fetches from other storage than step ${k + 1}.`);
    return out;
  });
}

function afterIssues(item: MenuItem, defs: readonly TaskDef[]): string[] {
  const out: string[] = [];
  const firstIndex = new Map<string, number>();
  defs.forEach((t, k) => {
    if (firstIndex.has(t.id)) out.push(`"${item.name}" has two tasks with id "${t.id}".`);
    else firstIndex.set(t.id, k);
  });
  const namedBy = new Map<string, string[]>();
  defs.forEach((t, k) => {
    for (const id of new Set(t.after ?? [])) {
      const j = firstIndex.get(id);
      if (j === undefined) out.push(`"${item.name}" task "${t.id}" waits for "${id}", which is not a task of this item.`);
      else if (j >= k) out.push(`"${item.name}" task "${t.id}" waits for "${id}", which must come earlier in the list.`);
      namedBy.set(id, [...(namedBy.get(id) ?? []), t.id]);
    }
  });
  for (const [id, by] of namedBy) {
    if (by.length > 1 && firstIndex.has(id)) out.push(`"${item.name}" task "${id}" feeds ${by.map((b) => `"${b}"`).join(" and ")}; a task can feed only one.`);
  }
  return out;
}

/** Problems with an item's task list, in plain words. Empty when valid or when the item has no `tasks`. */
export function taskIssues(item: MenuItem): readonly string[] {
  const defs = item.tasks;
  if (!defs) return [];
  return [...afterIssues(item, defs), ...stepIssues(item, defs)];
}

/** Stations this worker may work at: the home station first, no duplicates. */
export function workerCovers(w: WorkerDef): readonly string[] {
  return [...new Set([w.stationId, ...(w.covers ?? [])])];
}

function isChain(item: MenuItem): boolean {
  return itemTasks(item).every((t, k) => (k === 0 ? t.after.length === 0 : t.after.length === 1 && t.after[0] === k - 1));
}

/** True when every item is a chain and every worker covers one station: the kitchens the old engine handles. */
export function isChainKitchen(menu: readonly MenuItem[], workers: readonly WorkerDef[]): boolean {
  return menu.every(isChain) && workers.every((w) => workerCovers(w).length === 1);
}
