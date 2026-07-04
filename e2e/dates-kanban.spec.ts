import { test, expect, Page } from '@playwright/test';
import { gotoTasksClean, createTask } from './helpers';

/**
 * E2E — работа с датами, календарь, канбан-view, просроченные задачи (v0.9.22).
 *
 * Стратегия для дат: не тыкаем в кастомный DatePicker (нет нативного input),
 * а импортируем backup-JSON с задачей, у которой deadline уже проставлен.
 * Это надёжнее и покрывает больше кода (DeadlineBadge, Calendar-раскладку).
 */

function backupWithDeadline(taskTitle: string, deadline: string) {
  return {
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
        id: 777,
        title: taskTitle,
        comment: '',
        tag_id: null,
        status_id: 1,
        start_date: null,
        deadline,
        finish_date: null,
        archived: 0,
        sort_order: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
    templates: [],
  };
}

/** Импортирует backup через Settings → возвращается в /tasks. */
async function importBackup(page: Page, payload: unknown) {
  await page.locator('[data-onboarding="nav-settings"]').click();
  await expect(page).toHaveURL(/\/settings/);
  // Открываем таб «Экспорт/импорт» (в v0.9.22 Settings разбиты на табы).
  await page.getByRole('button', { name: /^Экспорт\/импорт$|^Export \/ Import$/ }).click();
  const fileInput = page.locator('input[type="file"]').first();
  await expect(fileInput).toBeAttached();
  await fileInput.setInputFiles({
    name: 'e2e-import.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(payload), 'utf-8'),
  });
  await page.getByRole('button', { name: /^Заменить всё$|^Replace all$/ }).click();
  await page.getByRole('button', { name: /^Заменить$|^Replace$/ }).click();
  await page.locator('[data-onboarding="nav-tasks"]').click();
  await expect(page).toHaveURL(/\/tasks/);
}

test.describe('канбан-view и просроченные задачи', () => {
  test.beforeEach(async ({ page }) => { await gotoTasksClean(page); });

  test('переключение вида list ↔ kanban', async ({ page }) => {
    await createTask(page, 'Задача для канбана');

    // Стартово — list view. Кнопка «Канбан» / «Kanban» имеет aria-selected=false.
    const kanbanTab = page.getByRole('tab', { name: /Канбан|Kanban/ });
    await expect(kanbanTab).toHaveAttribute('aria-selected', 'false');

    // Переключаемся в kanban.
    await kanbanTab.click();
    await expect(kanbanTab).toHaveAttribute('aria-selected', 'true');

    // Задача должна быть видна и в канбане.
    await expect(page.getByText('Задача для канбана').first()).toBeVisible();

    // Обратно в list.
    const listTab = page.getByRole('tab', { name: /^Список$|^List$/ });
    await listTab.click();
    await expect(listTab).toHaveAttribute('aria-selected', 'true');
  });

  test('просроченная задача показывает бейдж «Просрочено»', async ({ page }) => {
    // Deadline — вчера (в местном времени).
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const y = yesterday.getFullYear();
    const m = String(yesterday.getMonth() + 1).padStart(2, '0');
    const d = String(yesterday.getDate()).padStart(2, '0');
    const deadline = `${y}-${m}-${d}`;

    await importBackup(page, backupWithDeadline('Просроченная E2E-задача', deadline));

    // В списке рядом с задачей — красный бейдж с ⚠ Просрочено / Overdue.
    await expect(page.getByText('Просроченная E2E-задача').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/просрочено|overdue/i).first()).toBeVisible({ timeout: 5_000 });
  });

  test('задача с дедлайном сегодня показывает бейдж «Сегодня»', async ({ page }) => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const deadline = `${y}-${m}-${d}`;

    await importBackup(page, backupWithDeadline('Задача на сегодня', deadline));

    await expect(page.getByText('Задача на сегодня').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/^сегодня$|^today$/i).first()).toBeVisible({ timeout: 5_000 });
  });

  test('задача с дедлайном отображается на странице «Календарь»', async ({ page }) => {
    // Deadline — сегодня, чтобы календарь в дефолтном режиме «Неделя» точно её показал.
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const deadline = `${y}-${m}-${d}`;

    await importBackup(page, backupWithDeadline('Задача в календаре', deadline));

    await page.locator('[data-onboarding="nav-calendar"]').click();
    await expect(page).toHaveURL(/\/calendar/);
    await expect(page.getByText('Задача в календаре').first()).toBeVisible({ timeout: 10_000 });
  });
});
