import { test, expect } from '@playwright/test';
import { gotoTasksClean, createTask } from './helpers';

/**
 * E2E — редактирование и удаление задач (v0.9.22).
 *
 * Всё выполняется в списочном режиме (List view) в /tasks.
 * Байпас AuthScreen — ?e2e=1 (dev only). Онбординг закрывается helper'ом.
 */

test.describe('редактирование и удаление задачи', () => {
  test.beforeEach(async ({ page }) => { await gotoTasksClean(page); });

  test('редактирование заголовка через модалку задачи', async ({ page }) => {
    const original = 'E2E задача для редактирования';
    const edited = 'Отредактированный заголовок E2E';

    await createTask(page, original);

    // Клик по тексту заголовка включает inline-редактирование, поэтому для открытия TaskModal
    // жмём кнопку «Открыть полностью» (Maximize2) — она появляется на hover.
    const cardText = page.getByText(original).first();
    const card = cardText.locator('xpath=ancestor::div[contains(@class,"group")][1]');
    await card.hover();
    await card.getByRole('button', { name: /Открыть полностью|Open full editor/ }).click({ force: true });

    // TaskModal — role="dialog", первая textarea = поле заголовка задачи.
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    const modalTitle = dialog.locator('textarea').first();
    await expect(modalTitle).toBeVisible({ timeout: 5_000 });

    // Полностью заменяем содержимое (fill сам очищает).
    await modalTitle.fill(edited);

    // Жмём «Сохранить» / «Save» — это единственная кнопка, которая персистит изменения.
    await dialog.getByRole('button', { name: /^Сохранить$|^Save$/ }).click();

    // Модалка закрылась.
    await expect(dialog).toBeHidden();
    await expect(page.getByText(edited).first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(original)).toHaveCount(0);
  });

  test('удаление задачи через overlay-подтверждение', async ({ page }) => {
    const title = 'E2E задача для удаления';
    await createTask(page, title);

    // Наводим hover на карточку — появляется Trash-кнопка в правом верхнем углу.
    const cardText = page.getByText(title).first();
    const card = cardText.locator('xpath=ancestor::div[contains(@class,"group")][1]');
    await card.hover();

    // Кнопка удаления имеет aria-label «Удалить» / «Delete».
    const deleteBtn = card.getByRole('button', { name: /Удалить|Delete/ }).first();
    await deleteBtn.click({ force: true });

    // Появилась подтверждающая overlay-панель с двумя кнопками:
    // «Удалить» / «Delete» (подтвердить) и «Оставить» / «Keep».
    // Confirm-кнопка красная, ищем последнюю видимую с этим текстом (overlay в конце DOM).
    const confirmDeleteBtn = page.getByRole('button', { name: /^Удалить$|^Delete$/ }).last();
    await expect(confirmDeleteBtn).toBeVisible({ timeout: 3_000 });
    await confirmDeleteBtn.click();

    // Карточка исчезла из списка.
    await expect(page.getByText(title)).toHaveCount(0, { timeout: 5_000 });
  });

  test('отмена удаления оставляет задачу на месте', async ({ page }) => {
    const title = 'E2E задача — отмена удаления';
    await createTask(page, title);

    const cardText = page.getByText(title).first();
    const card = cardText.locator('xpath=ancestor::div[contains(@class,"group")][1]');
    await card.hover();
    const deleteBtn = card.getByRole('button', { name: /Удалить|Delete/ }).first();
    await deleteBtn.click({ force: true });

    // Жмём «Оставить» / «Keep»
    await page.getByRole('button', { name: /^Оставить$|^Keep$/ }).click();

    // Задача всё ещё в списке.
    await expect(page.getByText(title).first()).toBeVisible();
  });
});
