import { test, expect } from '@playwright/test';

/**
 * E2E smoke — v0.9.21.
 *
 * Проверяет, что приложение стартует под ?e2e=1 (dev-only байпас AuthScreen)
 * и рисует базовые элементы: сайдбар и вкладку «Задачи». Если этот тест падает —
 * все остальные тесты бессмысленны, поэтому smoke стоит первым.
 *
 * Перед каждым тестом чистим localStorage, чтобы у нас была чистая база
 * (sql.js стартует пустой, taskflow-store сбрасывается).
 */
test.describe('smoke', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try { localStorage.clear(); } catch {}
    });
  });

  test('приложение открывается и рисует сайдбар + тулбар Задач', async ({ page }) => {
    await page.goto('/?e2e=1');

    // Сайдбар помечен data-onboarding="sidebar" — это первый признак,
    // что мы прошли auth-gate и loading state.
    const sidebar = page.locator('[data-onboarding="sidebar"]');
    await expect(sidebar).toBeVisible({ timeout: 15_000 });

    // Вкладка «Задачи» открыта по умолчанию.
    await expect(page.locator('[data-onboarding="nav-tasks"]')).toBeVisible();

    // Тулбар «Задач»: split-кнопка «Новая задача».
    await expect(page.locator('[data-onboarding="new-task"]')).toBeVisible();
  });
});
