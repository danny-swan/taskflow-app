import { test, expect } from '@playwright/test';
import { gotoTasksClean, createTask } from './helpers';

/**
 * E2E — экспорт и импорт данных (v0.9.22).
 *
 * Экспорт: жмём JSON-кнопку в Settings → диалог с чекбоксами → «Экспортировать» → перехватываем download.
 * Импорт: подсовываем backup-JSON через <input type="file"> → появляется preview →
 *         жмём «Заменить всё» → в overlay ConfirmDialog жмём «Заменить».
 */

test.describe('экспорт и импорт', () => {
  test.beforeEach(async ({ page }) => { await gotoTasksClean(page); });

  test('JSON-экспорт скачивает валидный backup с созданной задачей', async ({ page }) => {
    const title = 'E2E задача для экспорта';
    await createTask(page, title);

    await page.locator('[data-onboarding="nav-settings"]').click();
    await expect(page).toHaveURL(/\/settings/);

    // Секция «Экспорт/импорт» скрыта под табом — кликаем по нему.
    await page.getByRole('button', { name: /^Экспорт\/импорт$|^Export \/ Import$/ }).click();

    // Кнопка JSON в секции «Экспорт». Ждём видимости (таб только что активирован).
    const jsonBtn = page.locator('button:has-text("JSON")').first();
    await expect(jsonBtn).toBeVisible({ timeout: 5_000 });
    await jsonBtn.click();

    // Диалог экспорта: перехват download до нажатия «Экспортировать» / «Export».
    const downloadPromise = page.waitForEvent('download', { timeout: 10_000 });
    await page.getByRole('button', { name: /^Экспортировать$|^Export$/ }).click();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^taskflow-\d{4}-\d{2}-\d{2}\.json$/);

    // Валидируем содержимое
    const path = await download.path();
    expect(path).toBeTruthy();
    const fs = await import('node:fs/promises');
    const raw = await fs.readFile(path!, 'utf-8');
    const payload = JSON.parse(raw);

    expect(payload).toHaveProperty('tasks');
    expect(payload).toHaveProperty('version');
    expect(Array.isArray(payload.tasks)).toBe(true);
    const titles = payload.tasks.map((t: { title: string }) => t.title);
    expect(titles).toContain(title);
  });

  test('JSON-импорт заменяет данные и импортированная задача появляется в списке', async ({ page }) => {
    // Готовим backup-JSON в формате v0.8.7+ (buildBackup() возвращает такой же).
    const backup = {
      version: '0.8.13',
      exported_at: new Date().toISOString(),
      include: { tasks: true, tags: true, statuses: true, templates: true },
      statuses: [
        { id: 1, name: 'To do',       color: '#94A3B8', behavior: 'start',   sort_order: 0, hidden: 0, default_collapsed: 0, is_technical: 0 },
        { id: 2, name: 'In progress', color: '#3B82F6', behavior: 'middle',  sort_order: 1, hidden: 0, default_collapsed: 0, is_technical: 0 },
        { id: 3, name: 'Done',        color: '#10B981', behavior: 'archive', sort_order: 2, hidden: 0, default_collapsed: 0, is_technical: 0 },
      ],
      tags: [],
      tasks: [
        {
          id: 999,
          title: 'Импортированная E2E-задача',
          comment: '',
          tag_id: null,
          status_id: 1,
          start_date: null,
          deadline: null,
          finish_date: null,
          archived: 0,
          sort_order: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
      templates: [],
    };

    await page.locator('[data-onboarding="nav-settings"]').click();
    await expect(page).toHaveURL(/\/settings/);

    // Открываем таб «Экспорт/импорт».
    await page.getByRole('button', { name: /^Экспорт\/импорт$|^Export \/ Import$/ }).click();

    // Скрытый <input type="file"> (className="hidden" = display:none) — setInputFiles работает без ожидания видимости.
    const fileInput = page.locator('input[type="file"]').first();
    await expect(fileInput).toBeAttached();
    await fileInput.setInputFiles({
      name: 'taskflow-import.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(backup), 'utf-8'),
    });

    // Появился backup preview с двумя кнопками: «Слить (добавить новое)» и «Заменить всё».
    await page.getByRole('button', { name: /^Заменить всё$|^Replace all$/ }).click();

    // Overlay ConfirmDialog: title «Заменить все данные?», confirm «Заменить» / «Replace».
    await page.getByRole('button', { name: /^Заменить$|^Replace$/ }).click();

    // Идём в /tasks и проверяем что импортированная задача есть.
    await page.locator('[data-onboarding="nav-tasks"]').click();
    await expect(page).toHaveURL(/\/tasks/);
    await expect(page.getByText('Импортированная E2E-задача').first()).toBeVisible({ timeout: 10_000 });
  });
});
