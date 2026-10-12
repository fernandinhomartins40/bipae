import { defineConfig, devices } from '@playwright/test';

const API_PORT = 3334;
const WEB_PORT = 5174;

/**
 * E2E against the real API (in-memory PostgreSQL via PGlite) and the web shell.
 * The desktop shell runs the same UI package; its E2E (WebdriverIO + tauri-driver)
 * is added with the Tauri build in CI (ADR-0012).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm --filter @bipae/api exec tsx src/main.ts',
      url: `http://localhost:${API_PORT}/v1/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        PORT: String(API_PORT),
        DATABASE_URL: 'pglite://memory',
        CORS_ORIGINS: `http://localhost:${WEB_PORT}`,
        LOGIN_RATE_LIMIT_PER_MINUTE: '1000',
      },
    },
    {
      command: `pnpm exec vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { VITE_API_URL: `http://localhost:${API_PORT}` },
    },
  ],
});
