import { describe, expect, it } from "vitest";
import type { MenuItem, TaskDef } from "../../src/core/types";
import { checkTasks, taskGraphIssues } from "./check-tasks";
import type { Issue, Sink } from "./checks";

const item = (tasks: readonly TaskDef[], steps = tasks.map((t) => ({ stationId: t.stationId, ...(t.fetchFrom ? { fetchFrom: t.fetchFrom } : {}) }))): MenuItem => ({
  id: "latte",
  name: "Latte",
  steps,
  tasks,
});

const JOIN: readonly TaskDef[] = [
  { id: "shot", stationId: "s-make" },
  { id: "milk", stationId: "s-steam", fetchFrom: ["fridge"] },
  { id: "pour", stationId: "s-make", after: ["shot", "milk"] },
];

describe("taskGraphIssues", () => {
  it("accepts an item without tasks and a valid join", () => {
    expect(taskGraphIssues({ id: "tea", name: "Tea", steps: [{ stationId: "s-make" }] })).toEqual([]);
    expect(taskGraphIssues(item(JOIN))).toEqual([]);
  });

  it("rejects a duplicate task id", () => {
    const tasks = [JOIN[0], { ...JOIN[1], id: "shot" }] as TaskDef[];
    expect(taskGraphIssues(item(tasks))).toContain('task id "shot" is used more than once.');
  });

  it("rejects an unknown after id", () => {
    const tasks = [JOIN[0], { ...JOIN[1], after: ["ghost"] }] as TaskDef[];
    expect(taskGraphIssues(item(tasks))).toContain('task "milk" waits for "ghost", which is not a task of this item.');
  });

  it("rejects an after id that is not earlier in the list (a cycle)", () => {
    const tasks: TaskDef[] = [
      { id: "a", stationId: "s-make", after: ["b"] },
      { id: "b", stationId: "s-make", after: ["a"] },
    ];
    expect(taskGraphIssues(item(tasks))).toContain('task "a" waits for "b", which must come earlier in the list.');
  });

  it("rejects a task named in after by more than one task", () => {
    const tasks: TaskDef[] = [
      { id: "shot", stationId: "s-make" },
      { id: "a", stationId: "s-make", after: ["shot"] },
      { id: "b", stationId: "s-make", after: ["shot"] },
    ];
    expect(taskGraphIssues(item(tasks))).toContain('task "shot" is named in "after" by "a" and "b"; a task can feed only one.');
  });

  it("rejects a steps count that differs from the tasks count", () => {
    expect(taskGraphIssues(item(JOIN, [{ stationId: "s-make" }]))).toEqual(['has 3 tasks but 1 steps; "steps[k]" and "tasks[k]" must match one to one.']);
  });

  it("rejects a step at another station or with other storage", () => {
    const steps = [{ stationId: "s-till" }, { stationId: "s-steam" }, { stationId: "s-make" }];
    expect(taskGraphIssues(item(JOIN, steps))).toEqual([
      'task "shot" is at "s-make", but steps[0] is at "s-till".',
      'task "milk" fetches from ["fridge"], but steps[1] fetches from [].',
    ]);
  });

  it("does not change its input", () => {
    const it0 = item(JOIN);
    const copy = structuredClone(it0);
    taskGraphIssues(it0);
    expect(it0).toEqual(copy);
  });
});

describe("checkTasks", () => {
  it("reports each issue against setup.json with the menu item", () => {
    const errors: Issue[] = [];
    const sink: Sink = { error: (file, message) => errors.push({ file, message }), warn: () => undefined };
    const cyclic: TaskDef[] = [
      { id: "a", stationId: "s-make", after: ["b"] },
      { id: "b", stationId: "s-make" },
    ];
    checkTasks([{ id: "tea", name: "Tea", steps: [{ stationId: "s-make" }] }, item(cyclic)], sink);
    expect(errors).toEqual([{ file: "setup.json", message: 'menu[1] ("latte"): task "a" waits for "b", which must come earlier in the list.' }]);
  });
});
