import { test, expect } from '@playwright/test';
import { gotoTasksClean } from './helpers';

/**
 * E2E Wave A (PR-4 «Управление пространствами»).
 *
 * Проверяет пользовательский поток без бэкенда (sql.js локально, ?e2e=1):
 *   • создание пространства из переключателя («+ Создать» → модалка → «Создать»);
 *   • переход на /workspace-settings, наличие вкладок Статусы/Теги/Дедлайны;
 *   • переименование пространства через карандаш (owner).
 *
 * Тип shared в e2e-режиме недоступен (free-юзер) — создаём personal, поэтому
 * вкладка «Участники» отсутствует, а удаление задизейблено (это ожидаемо).
 */
test.describe('workspace management', () => {
  test('создание пространства + настройки + переименование', async ({ page }) => {
    await gotoTasksClean(page);

    // 1. Открываем переключатель пространств и жмём «+ Создать».
    await page.getByRole('button', { name: 'Переключить пространство' }).click();
    await page.getByRole('button', { name: 'Создать пространство' }).click();

    // 2. Модалка создания: вводим имя и создаём.
    const nameInput = page.getByPlaceholder('Название пространства');
    await expect(nameInput).toBeVisible();
    await nameInput.fill('Мой проект');
    await page.getByRole('button', { name: 'Создать', exact: true }).click();
    await expect(nameInput).not.toBeVisible();

    // 3. Переключатель теперь показывает новое пространство.
    await expect(
      page.getByRole('button', { name: 'Переключить пространство' }),
    ).toContainText('Мой проект');

    // 4. Переходим в настройки пространства.
    await page.getByRole('button', { name: 'Переключить пространство' }).click();
    await page.getByRole('link', { name: 'Настройки пространства' }).click();
    await expect(page).toHaveURL(/workspace-settings/);

    // 5. Вкладки Статусы / Теги / Дедлайны присутствуют.
    await expect(page.getByRole('button', { name: 'Статусы' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Теги' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Дедлайны' })).toBeVisible();

    // 6. Переименование: карандаш → правим имя → сохраняем.
    await page.getByRole('button', { name: 'Переименовать пространство' }).click();
    const renameInput = page.getByRole('textbox', { name: 'Переименовать пространство' });
    await expect(renameInput).toBeVisible();
    await renameInput.fill('Переименованный');
    await renameInput.press('Enter');
    await expect(page.getByRole('heading', { name: 'Переименованный' })).toBeVisible();
  });
});
