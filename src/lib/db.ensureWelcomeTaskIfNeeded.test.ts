/**
 * db.ensureWelcomeTaskIfNeeded.test.ts — Unit-тест ensureWelcomeTaskIfNeeded()
 * (Fix 1, fix-round2).
 *
 * Функция гарантирует стартовую welcome-задачу для локального personal-ws,
 * прежде всего на free-плане (сеть paywalled, но локальная работа доступна).
 *
 * Контракт:
 *   • создаёт РОВНО одну welcome-задачу, только если задач ещё нет и welcome
 *     не создавали (маркер settings.welcome_seeded);
 *   • ставит маркер welcome_seeded в любом из завершающих случаев;
 *   • если задачи уже есть (fresh seed / работа пользователя) — welcome НЕ
 *     дублирует, лишь ставит маркер и возвращает false;
 *   • идемпотентна: повторный вызов — no-op (false);
 *   • enqueue задачи в sync_outbox (уйдёт при ближайшем push, когда план это
 *     разрешит);
 *   • clearUserData() сбрасывает маркер — новый аккаунт снова получит welcome.
 *
 * Гоняем реальный db.ts в web-режиме (sql.js), мокая только Vite-специфичный
 * `?url`-импорт wasm на реальный путь файла из node_modules.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const req = createRequire(import.meta.url);
const WASM_FILE_URL = pathToFileURL(req.resolve('sql.js/dist/sql-wasm.wasm')).href;
vi.mock('sql.js/dist/sql-wasm.wasm?url', () => ({ default: WASM_FILE_URL }));

const lsStore = new Map<string, string>();
beforeEach(() => {
  lsStore.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (lsStore.has(k) ? lsStore.get(k)! : null),
    setItem: (k: string, v: string) => { lsStore.set(k, v); },
    removeItem: (k: string) => { lsStore.delete(k); },
    clear: () => lsStore.clear(),
  });
});

function count(all: (sql: string) => any[], table: string): number {
  return all(`SELECT COUNT(*) AS c FROM ${table}`)[0].c as number;
}
function marker(all: (sql: string) => any[]): string | null {
  const rows = all(`SELECT value FROM settings WHERE key='welcome_seeded'`);
  return rows.length ? (rows[0].value as string) : null;
}

describe('ensureWelcomeTaskIfNeeded() — Fix 1', () => {
  it('пустая база (после clear+seed статусов): создаёт одну welcome-задачу + маркер', async () => {
    const { initDb, all, clearUserData, ensureSeededIfEmpty, ensureWelcomeTaskIfNeeded } = await import('./db');
    await initDb();
    await clearUserData();
    expect(count(all, 'tasks')).toBe(0);
    expect(marker(all)).toBeNull();

    // Статусы нужны для welcome (tasks.status_id NOT NULL).
    await ensureSeededIfEmpty();

    const created = await ensureWelcomeTaskIfNeeded('user-1');
    expect(created).toBe(true);
    expect(count(all, 'tasks')).toBe(1);
    expect(marker(all)).toBe('1');

    // Задача попала в очередь пуша.
    const taskOutbox = all(`SELECT COUNT(*) AS c FROM sync_outbox WHERE entity_table='tasks'`)[0].c as number;
    expect(taskOutbox).toBe(1);

    const title = all(`SELECT title FROM tasks LIMIT 1`)[0].title as string;
    expect(title).toContain('Добро пожаловать');
  });

  it('идемпотентна: повторный вызов не плодит вторую welcome-задачу', async () => {
    const { initDb, all, clearUserData, ensureSeededIfEmpty, ensureWelcomeTaskIfNeeded } = await import('./db');
    await initDb();
    await clearUserData();
    await ensureSeededIfEmpty();

    expect(await ensureWelcomeTaskIfNeeded('u')).toBe(true);
    expect(await ensureWelcomeTaskIfNeeded('u')).toBe(false);
    expect(count(all, 'tasks')).toBe(1);
  });

  it('если задачи уже есть (без маркера): welcome не дублируется, только маркер', async () => {
    // Web-режим db.ts — singleton-модуль, поэтому изолируем состояние явно:
    // clear + seed статусов, затем вставляем «пользовательскую» задачу вручную
    // и стираем маркер, имитируя базу с уже существующими задачами.
    const { initDb, all, run, clearUserData, ensureSeededIfEmpty, ensureWelcomeTaskIfNeeded } = await import('./db');
    await initDb();
    await clearUserData();
    await ensureSeededIfEmpty();
    const statusId = all(`SELECT id FROM statuses ORDER BY sort_order LIMIT 1`)[0].id as number;
    run(
      `INSERT INTO tasks (title, status_id, created_at, updated_at) VALUES ('уже есть', ?, datetime('now'), datetime('now'))`,
      [statusId],
    );
    run(`DELETE FROM settings WHERE key='welcome_seeded'`);

    const before = count(all, 'tasks');
    expect(before).toBeGreaterThan(0);
    expect(marker(all)).toBeNull();

    const created = await ensureWelcomeTaskIfNeeded('u');
    expect(created).toBe(false);
    // Дубликат не создан, маркер выставлен.
    expect(count(all, 'tasks')).toBe(before);
    expect(marker(all)).toBe('1');
  });

  it('clearUserData сбрасывает маркер → новый аккаунт снова получит welcome', async () => {
    const { initDb, all, clearUserData, ensureSeededIfEmpty, ensureWelcomeTaskIfNeeded } = await import('./db');
    await initDb();
    await clearUserData();
    await ensureSeededIfEmpty();
    await ensureWelcomeTaskIfNeeded('u1');
    expect(marker(all)).toBe('1');

    // Смена аккаунта: очистка стирает маркер.
    await clearUserData();
    expect(marker(all)).toBeNull();
    await ensureSeededIfEmpty();
    const created = await ensureWelcomeTaskIfNeeded('u2');
    expect(created).toBe(true);
    expect(count(all, 'tasks')).toBe(1);
  });
});
