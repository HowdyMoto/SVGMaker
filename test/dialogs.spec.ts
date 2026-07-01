import { test, expect } from '@playwright/test';

/**
 * The Legal (Privacy/Terms) and Contact dialogs were migrated off hand-rolled
 * overlays onto the shared Modal primitive. This pins that they open on
 * `.modal-dialog`, and — crucially — that STACKING works: opening Contact on top
 * of Legal, Escape dismisses only the topmost (Contact), leaving Legal open.
 * (Legal needs no auth; Contact opens even unconfigured, showing its "unavailable"
 * message, which is enough to exercise the stacking.)
 */

async function openHelp(page: import('@playwright/test').Page, action: string) {
  await page.locator('.menu-dropdown[data-menu="help"] .menu-trigger').click();
  await page.locator(`.menu-panel button[data-action="${action}"]`).click();
}

test('Legal dialog opens on the Modal primitive and Escape closes it', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.waitForFunction(() => (window as unknown as { state?: unknown }).state, { timeout: 15_000 });

  await openHelp(page, 'app.privacy');
  const legal = page.locator('#legal-overlay');
  await expect(legal).toBeVisible();
  await expect(legal.locator('.modal-dialog.legal-dialog')).toBeVisible();
  await expect(legal.locator('.modal-close')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(legal).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Contact stacks over Legal; Escape closes only the topmost', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as unknown as { state?: unknown }).state, { timeout: 15_000 });

  await openHelp(page, 'app.privacy');
  await expect(page.locator('#legal-overlay')).toBeVisible();

  // A "contact form" link inside the policy opens Contact stacked on top.
  await page.locator('#legal-overlay .legal-contact-link').first().click();
  await expect(page.locator('#contact-overlay')).toBeVisible();
  await expect(page.locator('.modal-overlay')).toHaveCount(2);

  // Escape closes the topmost (Contact) only — Legal stays.
  await page.keyboard.press('Escape');
  await expect(page.locator('#contact-overlay')).toHaveCount(0);
  await expect(page.locator('#legal-overlay')).toBeVisible();

  // Escape again closes Legal.
  await page.keyboard.press('Escape');
  await expect(page.locator('#legal-overlay')).toHaveCount(0);
});
