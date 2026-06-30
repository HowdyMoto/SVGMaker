import { test, expect } from '@playwright/test';

/**
 * Behaviour test for the shared Modal primitive (ui/modal.ts), exercised through
 * the real About dialog (Help → About). Pins the lifecycle every dialog now
 * inherits: opens, Escape closes, backdrop-click closes, the ✕ closes, and the
 * singleton guard prevents stacking.
 */

async function openAbout(page: import('@playwright/test').Page) {
  await page.locator('.menu-dropdown[data-menu="help"] .menu-trigger').click();
  await page.locator('.menu-panel button[data-action="app.about"]').click();
  await expect(page.locator('#about-overlay')).toBeVisible();
}

test('Modal: About dialog opens with proper a11y structure', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto('/');
  await page.waitForFunction(() => (window as unknown as { state?: unknown }).state, { timeout: 15_000 });

  await openAbout(page);
  const dialog = page.locator('#about-overlay .modal-dialog');
  await expect(dialog).toHaveAttribute('role', 'dialog');
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(dialog).toHaveClass(/about-dialog/);            // content class applied
  await expect(page.locator('#about-overlay .modal-close')).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('Modal: Escape closes', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as unknown as { state?: unknown }).state, { timeout: 15_000 });
  await openAbout(page);
  await page.keyboard.press('Escape');
  await expect(page.locator('#about-overlay')).toHaveCount(0);
});

test('Modal: backdrop click closes, dialog click does not', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as unknown as { state?: unknown }).state, { timeout: 15_000 });
  await openAbout(page);

  // Click inside the dialog — must NOT close.
  await page.locator('#about-overlay .modal-dialog').click({ position: { x: 10, y: 60 } });
  await expect(page.locator('#about-overlay')).toBeVisible();

  // Click the backdrop (top-left corner, outside the centered dialog) — closes.
  await page.locator('#about-overlay').click({ position: { x: 4, y: 4 } });
  await expect(page.locator('#about-overlay')).toHaveCount(0);
});

test('Modal: close button closes', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as unknown as { state?: unknown }).state, { timeout: 15_000 });
  await openAbout(page);
  await page.locator('#about-overlay .modal-close').click();
  await expect(page.locator('#about-overlay')).toHaveCount(0);
});

test('Modal: singleton guard prevents stacking', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as unknown as { state?: unknown }).state, { timeout: 15_000 });
  await openAbout(page);
  // Re-trigger the command while open — must not create a second overlay.
  await page.evaluate(() => {
    const btn = document.querySelector('.menu-panel button[data-action="app.about"]') as HTMLButtonElement;
    btn?.click();
  });
  await expect(page.locator('#about-overlay')).toHaveCount(1);
});
