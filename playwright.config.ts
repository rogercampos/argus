import { defineConfig } from '@playwright/test'

/**
 * E2E suite: drives the built Electron app (out/) through real windows.
 * Run with `pnpm test:e2e` (builds first). Each test launches its own app
 * instance with an isolated ARGUS_USER_DATA dir, so tests can run in parallel
 * and never touch real app state.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: 2,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    trace: 'retain-on-failure'
  }
})
