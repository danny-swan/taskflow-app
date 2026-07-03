import { test, expect } from '@playwright/test';

/**
 * E2E — happy paths по задачам.
 *
 * 1. Создание задачи через split-кнопку.
 * 2. Переключение sidebar → Календарь → Настройки → назад в Задачи.
 * 3. Тёмная тема через Настройки.
 *
 * Байпас AuthScreen — ?e2e=1 (dev only).
 */
test.describe('tasks — happy paths', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try { localStorage.clear(); } catch {}
    });
    await page.goto('/?e2e=1');
    await expect(page.locator('[data-onboarding="sidebar"]')).toBeVisible({ timeout: 15_000 });
  });

  test('создание задачи через модалку', async ({ page }) => {
    // Кликаем на кнопку «+ Новая задача» (первая кнопка внутри split-обёртки).
    const newTaskWrap = page.locator('[data-onboarding="new-task"]');
    await newTaskWrap.locator('button').first().click();

    // Модалка открылась — ждём поле «Название задачи».
    const titleInput = page.getByPlaceholder(/Название задачи|Task title/);
    await expect(titleInput).toBeVisible();
    await titleInput.fill('E2E test task');

    // Submit — кнопка «Добавить задачу» / «Add task».
    await page.getByRole('button', { name: /Добавить задачу|Add task/ }).click();

    // Модалка закрылась → в списке появилась карточка с нашим текстом.
    await expect(titleInput).not.toBeVisible();
    await expect(page.getByText('E2E test task').first()).toBeVisible({ timeout: 5_000 });
  });

  test('переключение вкладок sidebar', async ({ page }) => {
    // Календарь — на нём есть класс/значок current у активной кнопки сайдбара,
    // а тулбар «Задач» (кнопка new-task) исчезает.
    await page.locator('[data-onboarding="nav-calendar"]').click();
    await expect(page.locator('[data-onboarding="new-task"]')).toHaveCount(0);

    // Настройки
    await page.locator('[data-onboarding="nav-settings"]').click();
    await expect(page).toHaveURL(/\/settings/);

    // Обратно в Задачи → снова видим «Новая задача».
    await page.locator('[data-onboarding="nav-tasks"]').click();
    await expect(page).toHaveURL(/\/tasks/);
    await expect(page.locator('[data-onboarding="new-task"]')).toBeVisible();
  });

  test('переключение темы через быстрое меню в sidebar', async ({ page }) => {
    // Стартуем с чистой localStorage — тема по-умолчанию (светлая/либо system).
    // Открываем меню темы (кнопка aria-label="Theme" в сайдбаре).
    await page.getByRole('button', { name: 'Theme' }).click();

    // В меню кликаем по «Тёмная» / «Dark».
    await page.getByRole('button', { name: /^Тёмная$|^Dark$/ }).click();

    // ThemeProvider выставляет data-theme="dark" на <html>.
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });
});
