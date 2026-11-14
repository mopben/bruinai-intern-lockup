/**
 * Rule 4, one change by hand with an instant answer: a real pointer drag of
 * the Milk fridge changes what the kitchen can make an hour during the drag,
 * each update
 * within a frame or two of the pointer move; locked equipment does not move;
 * a fourth worker by button and by W; reset restores.
 */
import { BOX, expectStep, mainDebug, openStage, text } from "./support/stage";
import { expect, test } from "./support/fixtures";

/** Generous: one or two frames at 60 Hz is 17-33 ms; the software renderer in CI is slower. */
const MAX_LATENCY_MS = 100;

test("rule 4: dragging the fridge answers during the drag, within a frame or two", async ({ page }) => {
  await openStage(page, { step: 2 });
  await expectStep(page, "play");
  const profit0 = await text(page, "profit-per-hour");
  const basis0 = await text(page, "profit-basis");

  // Record pointer moves and every change of the profit line (its "could make" count), with page timestamps.
  await page.evaluate(() => {
    const g = globalThis as unknown as { __moves: number[]; __changes: { t: number; v: string }[] };
    g.__moves = [];
    g.__changes = [];
    // The "Fixed" hint shows for 1.6 s; remember that it appeared.
    new MutationObserver(() => {
      if (document.querySelector(".dr-hint.show")) (globalThis as unknown as { __hintSeen: boolean }).__hintSeen = true;
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class"] });
    window.addEventListener("pointermove", () => g.__moves.push(performance.now()), { capture: true });
    const target = document.querySelector('[data-testid="profit-per-hour"]')?.closest(".st-num") as Element;
    new MutationObserver(() => {
      const v = document.querySelector('[data-testid="profit-basis"]')?.textContent ?? "";
      const last = g.__changes.at(-1)?.v;
      if (v !== last) g.__changes.push({ t: performance.now(), v });
    }).observe(target, { subtree: true, childList: true, characterData: true });
  });

  const d = await mainDebug(page);
  const fridge = d.screen[BOX.fridge]!;
  const make = d.screen[BOX.make]!;
  const fridgeAt = d.items.find((i) => i.id === BOX.fridge)!;
  await page.mouse.move(fridge.x, fridge.y);
  await page.mouse.down();
  // Towards the espresso machine, in small real pointer moves.
  const steps = 30;
  for (let i = 1; i <= steps; i++) {
    const f = (i / steps) * 0.75;
    await page.mouse.move(fridge.x + (make.x - fridge.x) * f, fridge.y + (make.y - fridge.y) * f);
  }
  // Still holding the mouse button: the number has already answered.
  const during = await page.evaluate(() => (globalThis as unknown as { __changes: { t: number; v: string }[] }).__changes);
  const moves = await page.evaluate(() => (globalThis as unknown as { __moves: number[] }).__moves);
  expect(during.length, "what it can make an hour changed while dragging").toBeGreaterThan(0);
  expect(during.at(-1)!.v).not.toBe(basis0);
  for (const c of during) {
    const cause = moves.filter((m) => m <= c.t).at(-1);
    expect(cause, "a pointer move came before each change").toBeDefined();
    expect(c.t - (cause as number), "ms from pointer move to new number").toBeLessThan(MAX_LATENCY_MS);
  }
  const lat = during.map((c) => c.t - (moves.filter((m) => m <= c.t).at(-1) as number));
  test.info().annotations.push({ type: "latency", description: `${during.length} updates during the drag, max ${Math.max(...lat).toFixed(1)} ms after the pointer move` });
  await page.mouse.up();
  const moved = (await mainDebug(page)).items.find((i) => i.id === BOX.fridge)!;
  expect(Math.hypot(moved.x - fridgeAt.x, moved.z - fridgeAt.z)).toBeGreaterThan(0.3);
  // It could not keep up with the orders coming in, so a faster kitchen makes more.
  await expect(page.getByTestId("profit-per-hour-before")).toHaveText(profit0);

  // Locked equipment does not move, and says why.
  await page.keyboard.press("Backspace");
  await expect(page.getByTestId("profit-basis")).toHaveText(basis0);
  const d2 = await mainDebug(page);
  const espresso = d2.items.find((i) => i.id === BOX.make)!;
  expect(espresso.locked).toBe(true);
  const p = d2.screen[BOX.make]!;
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 120, p.y + 80, { steps: 10 });
  await page.mouse.up();
  const after = (await mainDebug(page)).items.find((i) => i.id === BOX.make)!;
  expect([after.x, after.z]).toEqual([espresso.x, espresso.z]);
  await expect.poll(() => page.evaluate(() => (globalThis as unknown as { __hintSeen?: boolean }).__hintSeen === true)).toBe(true);
  await expect(page.locator(".dr-hint")).toContainText(/fixed|power|plumb|locked/i);
  await expect(page.getByTestId("profit-per-hour")).toHaveText(profit0);

  // A fourth worker with the button: profit changes, and goes back when taken away.
  await page.getByTestId(`btn-add-worker-${BOX.make}`).click();
  await expect(page.getByTestId("profit-per-hour")).not.toHaveText(profit0);
  await expect(page.getByTestId("staffing").locator(".st-hat")).toHaveCount(4);
  await page.getByTestId(`btn-remove-worker-${BOX.make}`).click();
  await expect(page.getByTestId("staffing").locator(".st-hat")).toHaveCount(3);
  await expect(page.getByTestId("profit-per-hour")).toHaveText(profit0);

  // And with W.
  await page.keyboard.press("w");
  await expect(page.getByTestId("staffing").locator(".st-hat")).toHaveCount(4);
  await expect(page.getByTestId("profit-per-hour")).not.toHaveText(profit0);

  // Reset restores the number and the staffing.
  await page.getByTestId("btn-reset").click();
  await expect(page.getByTestId("profit-per-hour")).toHaveText(profit0);
  await expect(page.getByTestId("staffing").locator(".st-hat")).toHaveCount(3);
});
