/**
 * Task graphs in setup.json: ids that are unique, "after" ids that name an
 * earlier task of the same item, a task that feeds at most one other, and
 * steps that match tasks one to one.
 *
 * Written separately from src/core on purpose: the world shares only types and
 * protocol constants with the model, so this check does not reuse the model's.
 */
import type { MenuItem, StepDef, TaskDef } from "../../src/core/types";
import type { Sink } from "./checks";

const F = "setup.json";

const list = (ids: readonly string[] | undefined): string => JSON.stringify(ids ?? []);

function idIssues(tasks: readonly TaskDef[]): readonly string[] {
  const ids = tasks.map((t) => t.id);
  const repeated = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  return repeated.map((id) => `task id "${id}" is used more than once.`);
}

function afterIssues(tasks: readonly TaskDef[]): readonly string[] {
  const firstAt = new Map<string, number>();
  tasks.forEach((t, k) => {
    if (!firstAt.has(t.id)) firstAt.set(t.id, k);
  });
  return tasks.flatMap((t, k) =>
    [...new Set(t.after ?? [])].flatMap((id) => {
      const j = firstAt.get(id);
      if (j === undefined) return [`task "${t.id}" waits for "${id}", which is not a task of this item.`];
      return j >= k ? [`task "${t.id}" waits for "${id}", which must come earlier in the list.`] : [];
    }),
  );
}

function feedIssues(tasks: readonly TaskDef[]): readonly string[] {
  const known = new Set(tasks.map((t) => t.id));
  const fedBy = (id: string): readonly string[] => tasks.filter((t) => (t.after ?? []).includes(id)).map((t) => t.id);
  return [...known].flatMap((id) => {
    const by = fedBy(id);
    return by.length > 1 ? [`task "${id}" is named in "after" by ${by.map((b) => `"${b}"`).join(" and ")}; a task can feed only one.`] : [];
  });
}

function stepIssues(tasks: readonly TaskDef[], steps: readonly StepDef[]): readonly string[] {
  if (tasks.length !== steps.length) {
    return [`has ${tasks.length} tasks but ${steps.length} steps; "steps[k]" and "tasks[k]" must match one to one.`];
  }
  return tasks.flatMap((t, k) => {
    const s = steps[k];
    if (!s) return [];
    const station = s.stationId === t.stationId ? [] : [`task "${t.id}" is at "${t.stationId}", but steps[${k}] is at "${s.stationId}".`];
    const storage = list(s.fetchFrom) === list(t.fetchFrom) ? [] : [`task "${t.id}" fetches from ${list(t.fetchFrom)}, but steps[${k}] fetches from ${list(s.fetchFrom)}.`];
    return [...station, ...storage];
  });
}

/** Problems with one item's task graph, in plain words. Empty when the item has no `tasks`. */
export function taskGraphIssues(item: MenuItem): readonly string[] {
  const tasks = item.tasks;
  if (!tasks) return [];
  return [...idIssues(tasks), ...afterIssues(tasks), ...feedIssues(tasks), ...stepIssues(tasks, item.steps)];
}

/** Reports every task-graph problem as a setup.json error naming the menu item. */
export function checkTasks(menu: readonly MenuItem[], s: Sink): void {
  menu.forEach((m, mi) => {
    for (const issue of taskGraphIssues(m)) s.error(F, `menu[${mi}] ("${m.id}"): ${issue}`);
  });
}
