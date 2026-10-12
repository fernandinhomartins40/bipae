import { defineConfig, devices } from '@playwright/test';

const API_PORT = 3334;
const WEB_PORT = 5174;
const DESKTOP_UI_PORT = 1421;

/**
 * E2E against the real API (in-memory PostgreSQL via PGlite) and both shells' frontends.
 * The same specs run for "web" and "desktop-ui" (ADR-0012). Running them inside the real
 * Tauri WebView (WebdriverIO + tauri-driver) is a CI job added with the native drivers.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  // One shared in-process API with PGlite: parallel browsers just queue on it and time out.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'web', use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${WEB_PORT}` } },
    {
      name: 'desktop-ui',
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${DESKTOP_UI_PORT}` },
    },
  ],
  webServer: [
    {
      // Bipaê Conector simulator on a test port, so it never clashes with a real Conector.
      command: 'pnpm exec tsx scripts/connector-simulator.ts',
      url: 'http://127.0.0.1:47811/state',
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        CONNECTOR_PORT: '47810',
        CONNECTOR_CODE: '123456',
        CONNECTOR_ORIGINS: `http://localhost:${WEB_PORT}`,
      },
    },
    {
      command: 'pnpm --filter @bipae/api exec tsx src/main.ts',
      url: `http://localhost:${API_PORT}/v1/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        PORT: String(API_PORT),
        DATABASE_URL: 'pglite://memory',
        CORS_ORIGINS: `http://localhost:${WEB_PORT},http://localhost:${DESKTOP_UI_PORT}`,
        LOGIN_RATE_LIMIT_PER_MINUTE: '1000',
        // Test-only: this sign-up becomes the first Bipaê staff owner (ignored in production).
        PLATFORM_BOOTSTRAP_EMAIL: 'admin-e2e@exemplo.com.br',
        DESKTOP_RELEASES_REPO: '',
      },
    },
    {
      command: `pnpm exec vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        VITE_API_URL: `http://localhost:${API_PORT}`,
        VITE_CONNECTOR_URL: 'ws://127.0.0.1:47810',
      },
    },
    {
      command: `pnpm --filter @bipae/desktop exec vite --port ${DESKTOP_UI_PORT} --strictPort`,
      url: `http://localhost:${DESKTOP_UI_PORT}`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { VITE_API_URL: `http://localhost:${API_PORT}` },
    },
  ],
});
