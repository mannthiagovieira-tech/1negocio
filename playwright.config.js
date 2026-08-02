// @ts-check
/**
 * Playwright · MANDATO chassi E2E
 * Serve /Users/premium/1negocio/ via python3 -m http.server 8899
 * e roda os testes contra http://127.0.0.1:8899/mandato/*
 *
 * Credenciais lidas de E2E_EMAIL e E2E_PASS (nunca hardcoded).
 */
const { defineConfig, devices } = require('@playwright/test');

const PORT = 8899;
const BASE = `http://127.0.0.1:${PORT}`;

module.exports = defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,        // sequencial · evita cross-talk de sessão Supabase
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  timeout: 30_000,
  use: {
    baseURL: BASE,
    trace: 'retain-on-failure',
    video: 'off',
    screenshot: 'only-on-failure',
    actionTimeout: 8_000,
    navigationTimeout: 15_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: `python3 -m http.server ${PORT} --bind 127.0.0.1`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
    timeout: 10_000,
  },
});
