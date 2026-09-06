import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  workers: 1,
  // Hosted runners render WebGL in software, so multi-step flows take longer.
  timeout: process.env.CI ? 90_000 : 45_000,
  use: { baseURL: 'http://127.0.0.1:5173', ...devices['Desktop Chrome'], trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5173/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
})
