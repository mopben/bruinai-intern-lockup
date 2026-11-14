import { describe, expect, it } from "vitest";
import type { MenuItem, TaskDef } from "./types";
import { isChainKitchen, itemTasks, taskIssues, workerCovers } from "./tasks";
import { worker } from "./testkit";

/** A menu item whose steps mirror its tasks. */
function itemWith(tasks: readonly TaskDef[]): MenuItem {
  return {
    id: "x",
    name: "X",
    steps: tasks.map((t) => ({ stationId: t.stationId, ...(t.fetchFrom ? { fetchFrom: t.fetchFrom } : {}) })),
    tasks,
  };
}

const join: MenuItem = {
  id: "x",
  name: "X",
  steps: [{ stationId: "a" }, { stationId: "b" }, { stationId: "c" }],
  tasks: [{ id: "p", stationId: "a" }, { id: "q", stationId: "b" }, { id: "r", stationId: "c", after: ["p", "q"] }],
};

describe("itemTasks", () => {
  it("reads steps as a chain", () => {
    const t = itemTasks({ id: "latte", name: "Latte", steps: [{ stationId: "a" }, { stationId: "b", fetchFrom: ["f"] }] });
    expect(t.map((x) => [x.id, x.after, x.next])).toEqual([["s0", [], 1], ["s1", [0], null]]);
    expect(t[1]?.fetchFrom).toEqual(["f"]);
    expect(t[0]?.fetchFrom).toEqual([]);
  });

  it("reads a join", () => {
    expect(taskIssues(join)).toEqual([]);
    expect(itemTasks(join).map((x) => x.next)).toEqual([2, 2, null]);
    expect(itemTasks(join).map((x) => x.after)).toEqual([[], [], [0, 1]]);
  });

  it("does not throw on a broken task list", () => {
    const t = itemTasks(itemWith([{ id: "p", stationId: "a", after: ["zz", "p"] }]));
    expect(t.map((x) => x.after)).toEqual([[0]]);
  });
});

describe("taskIssues", () => {
  it("has nothing to say about an item without tasks", () => {
    expect(taskIssues({ id: "l", name: "L", steps: [{ stationId: "a" }] })).toEqual([]);
  });

  it.each([
    ["unknown id", [{ id: "p", stationId: "a", after: ["zz"] }]],
    ["out of order", [{ id: "p", stationId: "a", after: ["q"] }, { id: "q", stationId: "b" }]],
    ["a cycle", [{ id: "p", stationId: "a", after: ["p"] }]],
    ["output splits", [{ id: "p", stationId: "a" }, { id: "q", stationId: "b", after: ["p"] }, { id: "r", stationId: "c", after: ["p"] }]],
    ["duplicate id", [{ id: "p", stationId: "a" }, { id: "p", stationId: "b" }]],
  ] as const)("rejects %s", (_n, tasks) => {
    expect(taskIssues(itemWith(tasks)).length).toBeGreaterThan(0);
  });

  it("names the item and the task", () => {
    const text = taskIssues(itemWith([{ id: "p", stationId: "a", after: ["zz"] }])).join();
    expect(text).toMatch(/"X"/);
    expect(text).toMatch(/"p"/);
    expect(text).toMatch(/"zz"/);
  });

  it("rejects steps that disagree with tasks", () => {
    const station = { ...itemWith([{ id: "p", stationId: "b" }]), steps: [{ stationId: "a" }] };
    expect(taskIssues(station).join()).toMatch(/station/);
    const fetch = { ...itemWith([{ id: "p", stationId: "a", fetchFrom: ["f"] }]), steps: [{ stationId: "a" }] };
    expect(taskIssues(fetch).join()).toMatch(/fetch/);
    const count = { ...itemWith([{ id: "p", stationId: "a" }]), steps: [{ stationId: "a" }, { stationId: "b" }] };
    expect(taskIssues(count).length).toBeGreaterThan(0);
  });
});

describe("workerCovers", () => {
  it("puts home first and drops duplicates", () => {
    expect(workerCovers({ id: "w", name: "W", color: "#000000", stationId: "a", covers: ["b", "a"] })).toEqual(["a", "b"]);
  });

  it("is the home station alone by default", () => {
    expect(workerCovers(worker("w", "a"))).toEqual(["a"]);
  });
});

describe("isChainKitchen", () => {
  const chain: MenuItem = { id: "l", name: "L", steps: [{ stationId: "a" }, { stationId: "b" }] };

  it("is true for chains and one-station workers", () => {
    expect(isChainKitchen([chain], [worker("w", "a"), { ...worker("v", "b"), covers: ["b"] }])).toBe(true);
    const spelled = itemWith([{ id: "p", stationId: "a" }, { id: "q", stationId: "b", after: ["p"] }]);
    expect(isChainKitchen([spelled], [worker("w", "a")])).toBe(true);
  });

  it("is false for a join or a covering worker", () => {
    expect(isChainKitchen([join], [worker("w", "a")])).toBe(false);
    expect(isChainKitchen([chain], [{ ...worker("w", "a"), covers: ["b"] }])).toBe(false);
  });
});
