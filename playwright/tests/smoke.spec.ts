import { test, expect } from '@playwright/test';

test.skip(process.env.PLAYWRIGHT_SMOKE !== '1', 'Set PLAYWRIGHT_SMOKE=1 to run the smoke suite.');

test.describe('Otto UI smoke', () => {
  test('app loads, root visible, document has a title', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#root')).toBeVisible();
    const title = await page.title();
    expect(title.trim().length).toBeGreaterThan(0);
  });

  test('hash routes: dashboard and memory shells', async ({ page }) => {
    await page.goto('/#/');
    await expect(page.getByTestId('view-dashboard-heading')).toBeVisible();

    await page.goto('/#/memory');
    await expect(page.getByTestId('view-memory-heading')).toBeVisible();
  });
});
