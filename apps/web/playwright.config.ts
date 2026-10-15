import { defineConfig, devices } from '@playwright/test';

// Rode via `pnpm test:e2e` (e2e/run.mts): ele sobe o banco de teste, faz o build e define as envs.
const PORT = Number(process.env.E2E_PORT ?? 3200);

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
