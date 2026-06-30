import { defineConfig } from '@playwright/test';

/**
 * Playwright config for the SVG import/round-trip corpus tests.
 *
 * The importer relies on real browser SVG behaviour (DOM parsing, `<use>`/filter
 * resolution, layout/getBBox, href sanitization), so these run in a real browser
 * against the actual dev-served app rather than a simulated DOM. The test drives
 * the app's DEV-only `window.state` global.
 *
 * Locally it uses the system Google Chrome (channel: 'chrome') so no browser
 * download is needed; in CI it uses Playwright's bundled Chromium (installed via
 * `npx playwright install chromium`), which is more reproducible on runners.
 * The large corpus must be present first: `npm run corpus:fetch`.
 */
export default defineConfig({
  testDir: './test',
  fullyParallel: false,        // big files are memory-heavy; run serially
  workers: 1,
  timeout: 120_000,            // 79MB / 117k-element files take a few seconds each
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:5180',
    // System Chrome locally; bundled Chromium in CI.
    channel: process.env.CI ? undefined : 'chrome',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5180',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
