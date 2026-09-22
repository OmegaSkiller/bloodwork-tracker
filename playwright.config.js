import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:18787', viewport: { width: 1440, height: 1080 }, reducedMotion: 'reduce', trace: 'retain-on-failure' },
  webServer: { command: 'node tests/helpers/browser-server.mjs', url: 'http://127.0.0.1:18787/api/health', reuseExistingServer: false },
})
