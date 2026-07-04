import { expect, Page } from '@playwright/test';

/**
 * Заходит на /tasks с байпасом auth (?e2e=1) и ждёт готовности sidebar.
 *
 * В e2e-режиме компонент <Onboarding /> не рендерится вообще
 * (см. src/App.tsx, v0.9.22) — раньше его spotlight-overlay перехватывал
 * клики Playwright и делал тесты флаки.
 */
export async function gotoTasksClean(page: Page) {
  await page.addInitScript(() => {
    try { localStorage.clear(); } catch {}
  });
  await page.goto('/?e2e=1');
  await expect(page.locator('[data-onboarding="sidebar"]')).toBeVisible({ timeout: 15_000 });
}

/** Создаёт задачу через модалку «+ Новая задача». */
export async function createTask(page: Page, title: string) {
  const newTaskWrap = page.locator('[data-onboarding="new-task"]');
  await newTaskWrap.locator('button').first().click();
  const titleInput = page.getByPlaceholder(/Название задачи|Task title/);
  await expect(titleInput).toBeVisible();
  await titleInput.fill(title);
  await page.getByRole('button', { name: /Добавить задачу|Add task/ }).click();
  await expect(titleInput).not.toBeVisible();
  await expect(page.getByText(title).first()).toBeVisible({ timeout: 5_000 });
}
