import { defineConfig, devices } from '@playwright/test';

/**
 * TaskFlow E2E (v0.9.21).
 *
 * Стратегия:
 * - Прогоняем через Vite dev-server (`npm run dev`) в браузере Chromium.
 *   Tauri-специфичное поведение (deep links, native updater) мы через E2E
 *   не тестируем — только UI-логику: задачи, доска, темы, экспорт/импорт,
 *   онбординг.
 * - Auth-guard обходим через ?e2e=1 (dev-only байпас в src/App.tsx).
 * - Между тестами Playwright сам чистит контекст (свежий localStorage),
 *   поэтому каждый тест стартует с «первого запуска» приложения.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false, // одиночный Vite-инстанс, тесты трогают localStorage
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
