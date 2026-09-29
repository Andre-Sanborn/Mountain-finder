/**
 * The deployment self-check (docs/DEPLOY.md).
 *
 * Deliberately a SEPARATE Playwright project from the root config, because the
 * thing under test is different: `playwright.config.ts` starts `npm run dev`,
 * so every one of its specs runs against Vite — including the terrain plugin
 * that a deployed app does not have. This config starts nothing but
 * `scripts/static-server.ts` over the packaged `dist/`, so a pass means the
 * BUILT bundle plus the PACKAGED directory work with no dev server, no plugin
 * and no bundler in the process.
 *
 *   npm run build && npm run package:deploy -- --gzip && npm run test:deploy
 */

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, devices } from '@playwright/test';

import { BASE_PATH, SERVE_DIR } from './serving.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const PORT = 5210;

// A subpath deployment serves the same package from a different URL prefix;
// `serving.ts` says where that comes from.


/** Same rule as the root config: prefer this environment's Chromium. */
const preinstalledChromium = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const launchOptions = existsSync(preinstalledChromium)
  ? { executablePath: preinstalledChromium }
  : {};

export default defineConfig({
  testDir: HERE,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? 'line' : [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions } }],
  webServer: {
    command: `npx tsx scripts/static-server.ts ${SERVE_DIR} --port ${PORT}`,
    cwd: ROOT,
    url: `http://localhost:${PORT}${BASE_PATH}terrain/manifest.json`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
