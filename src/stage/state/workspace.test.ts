// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cafeKit, kitLayout, kitScan, kitSetup } from "../../core/testkit";
import { addWorker } from "../app/kitchen-edit";
import { setRecipeQuantity, updateRecipe } from "../app/recipes";
import { editKitchen } from "./kitchen-actions";
import { storedEconomics } from "./economics";
import { activeSetupId, activeShiftId, base, candidates, firstRun, kitchen, kitchenOrigin, playLayout, workspaceReady } from "./store";
import { createSetup, createShift, initializeWorkspace, renameSetup, renameShift, saveWorkspace, savedSetups, savedShifts, selectSetup, selectShift } from "./workspace";

let cleanup: (() => void) | undefined;
beforeEach(() => {
  localStorage.clear();
  workspaceReady.value = false;
  activeSetupId.value = null; activeShiftId.value = null;
  savedSetups.value = []; savedShifts.value = [];
  base.value = null; firstRun.value = null; candidates.value = []; storedEconomics.value = null;
  const kit = cafeKit();
  kitchen.value = { scan: kitScan(kit), setup: kitSetup(kit), layout: kitLayout(kit) };
  kitchenOrigin.value = "recorded"; playLayout.value = kitchen.value.layout;
  cleanup = initializeWorkspace();
});
afterEach(() => { cleanup?.(); cleanup = undefined; });

describe("saved setups and shifts", () => {
  it("keeps staffing and wages independent when switching setups", () => {
    expect(activeSetupId.value).toBeNull();
    createSetup(); renameSetup({ name: "Baseline" });
    const a = activeSetupId.value!;
    createSetup(); renameSetup({ name: "Extra staff" });
    const b = activeSetupId.value!;
    playLayout.value = addWorker(playLayout.value!, "make");
    storedEconomics.value = { wagePerHour: 27 };
    selectSetup(a);
    expect(playLayout.value!.workers).toHaveLength(3);
    expect(storedEconomics.value).toBeNull();
    selectSetup(b);
    expect(playLayout.value!.workers).toHaveLength(4);
    expect(storedEconomics.value?.wagePerHour).toBe(27);
  });

  it("keeps recipes, quantities, and arrival times independent between shifts", () => {
    createSetup(); createShift(); renameShift("Morning");
    const a = activeShiftId.value!;
    editKitchen((k) => setRecipeQuantity(updateRecipe(k, "latte", { name: "Morning latte" }), "latte", 2));
    createShift(); renameShift("Evening");
    const b = activeShiftId.value!;
    expect(kitchen.value!.setup.schedule.orders).toHaveLength(0);
    editKitchen((k) => setRecipeQuantity(updateRecipe(k, "latte", { name: "Evening latte" }), "latte", 5));
    selectShift(a);
    expect(kitchen.value!.setup.menu[0]!.name).toBe("Morning latte");
    expect(kitchen.value!.setup.schedule.orders).toHaveLength(2);
    selectShift(b);
    expect(kitchen.value!.setup.menu[0]!.name).toBe("Evening latte");
    expect(kitchen.value!.setup.schedule.orders).toHaveLength(5);
  });

  it("restores the active setup and shift without overwriting their saved orders with the boot template", () => {
    createSetup(); renameSetup({ name: "Saved kitchen" }); createShift(); renameShift("Lunch");
    editKitchen((k) => setRecipeQuantity(k, "latte", 7));
    saveWorkspace(); cleanup?.();
    activeSetupId.value = null; activeShiftId.value = null;
    const kit = cafeKit();
    kitchen.value = { scan: kitScan(kit), setup: kitSetup(kit), layout: kitLayout(kit) };
    playLayout.value = kitchen.value.layout;
    savedSetups.value = []; savedShifts.value = [];
    cleanup = initializeWorkspace();
    expect(savedSetups.value[0]!.name).toBe("Saved kitchen");
    expect(savedShifts.value[0]!.name).toBe("Lunch");
    expect(kitchen.value!.setup.schedule.orders).toHaveLength(7);
  });
});
