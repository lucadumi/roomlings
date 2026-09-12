import { defineConfig, devices } from '@playwright/test'

const externalBaseURL = process.env.PLAYWRIGHT_BASE_URL

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  workers: 1,
  // Hosted runners render WebGL in software, so multi-step flows take longer.
  timeout: process.env.CI ? 90_000 : 45_000,
  // A software-rendered frame can block even a correct browser query for over five seconds.
  expect: { timeout: process.env.CI ? 10_000 : 5_000 },
  reporter: 'list',
  use: {
    baseURL: externalBaseURL ?? 'http://127.0.0.1:5173',
    ...devices['Desktop Chrome'],
    // Keep action, DOM, and network traces without continuously capturing software-rendered frames.
    trace: process.env.CI
      ? { mode: 'retain-on-failure', screenshots: false, snapshots: true, sources: true }
      : 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: externalBaseURL ? undefined : {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5173/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
})
