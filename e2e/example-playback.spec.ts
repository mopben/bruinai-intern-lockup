import { test, expect } from './support/fixtures';
import { openStage, chooseLibraryEntry, clearShiftOrders, sceneDebug } from './support/stage';

test('example starts at zero and fast forward reaches a late arrival without seeking', async ({ page }) => {
  await openStage(page);
  await page.getByTestId('step-orders').click();
  await chooseLibraryEntry(page, 'shift', '__create_shift__');
  await clearShiftOrders(page);
  const recipe = page.getByTestId('recipe-latte');
  await recipe.locator('summary').click();
  await recipe.getByLabel('Quantity in simulation').fill('1');
  await recipe.getByLabel('Quantity in simulation').blur();
  await page.getByTestId('shift-arrivals').locator('summary').click();
  await page.getByTestId('shift-arrivals').locator('input').first().fill('120');
  await page.getByTestId('step-results').click();
  await expect.poll(async () => (await sceneDebug(page, 'compare-before'))?.workers.length).toBe(3);
  const before = (await sceneDebug(page, 'compare-before'))!.workers;
  const profit = await page.getByTestId('compare-before-profit').innerText();
  await page.getByTestId('btn-play').click();
  await expect(page.getByTestId('compare-clock')).toHaveText(/0:0[0-5]/);
  await page.getByTestId('btn-faster').click();
  await expect(page.getByTestId('compare-clock')).toHaveText(/0:0[0-9]/);
  await expect.poll(async () => {
    const after = (await sceneDebug(page, 'compare-before'))?.workers ?? [];
    return after.some(worker => { const previous = before.find(w => w.id === worker.id); return previous && Math.hypot(worker.x - previous.x, worker.z - previous.z) > .05; });
  }, { timeout: 15000 }).toBe(true);
  await expect(page.getByTestId('compare-before-profit')).toHaveText(profit);
  await page.getByRole('button', { name: 'Reset example', exact: true }).click();
  await expect(page.getByTestId('compare-clock')).toHaveCount(0);
  await page.getByTestId('btn-play').click();
  await expect(page.getByTestId('compare-clock')).toHaveText(/0:0[0-5]/);
  await expect(page.getByTestId('btn-faster')).toContainText('Faster');
});
