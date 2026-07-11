/**
 * db.clearUserData.test.ts — Unit-тест clearUserData() (v0.9.35-dev.6.9.0).
 *
 * clearUserData() — это вариант «Загрузить облачные» в AccountSwitchGate: он
 * удаляет локальные данные, чтобы следующий sync подтянул базу нового аккаунта.
 * Один баг в списке удаляемых/сохраняемых ключей = тихая потеря снимков или
 * client_id → safety net перестаёт работать. Поэтому проверяем контракт явно:
 *
 *   УДАЛЯЕТ:   tasks, tags, statuses, task_templates, overdue_events,
 *              sync_outbox, sync_last_pulled_%
 *   СОХРАНЯЕТ: client_id, snapshot_registry_v1, bound_user_id, UI-настройки
 *
 * Гоняем реальный db.ts в web-режиме (sql.js), мокая только Vite-специфичный
 * `?url`-импорт wasm на реальный путь файла из node_modules.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// Vite-импорт `sql.js/dist/sql-wasm.wasm?url` в Node не резолвится — подменяем
// на file://-URL реального wasm, чтобы initSqlJs({ locateFile }) его нашёл.
const req = createRequire(import.meta.url);
const WASM_FILE_URL = pathToFileURL(req.resolve('sql.js/dist/sql-wasm.wasm')).href;
vi.mock('sql.js/dist/sql-wasm.wasm?url', () => ({ default: WASM_FILE_URL }));

// localStorage-полифилл поверх jsdom (детерминированный, чистится в beforeEach).
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

/** Число строк в таблице (реальный db через all()). */
function tableCount(all: (sql: string) => any[], table: string): number {
  return all(`SELECT COUNT(*) AS c FROM ${table}`)[0].c as number;
}

describe('clearUserData() — контракт удаления/сохранения', () => {
  it('удаляет пользовательские данные, но сохраняет client_id / снимки / привязку / UI', async () => {
    const db = await import('./db');
    const { initDb, run, get, all, clearUserData } = db;

    await initDb();

    // ── Заполняем базу пользовательскими данными ──────────────────────────
    run(`INSERT INTO statuses (name, color, behavior, sort_order) VALUES ('S', '#111', 'middle', 0)`);
    run(`INSERT INTO tags (name, color, sort_order) VALUES ('T', '#222', 0)`);
    run(
      `INSERT INTO tasks (title, comment, status_id, created_at, updated_at) VALUES ('Task','', 1, '2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
    );
    // overdue_events ссылается на task; кладём одну запись (схема допускает).
    try { run(`INSERT INTO overdue_events (task_id, event_date) VALUES (1, '2026-01-02')`); } catch { /* схема может отличаться — не критично */ }
    // Кладём запись в sync_outbox (эмулируем несинхронизированную мутацию).
    run(
      `INSERT INTO sync_outbox (entity_table, entity_uuid, op, queued_at, attempt_count) VALUES ('tasks', 'uuid-1', 'upsert', datetime('now'), 0)`,
    );

    // Ключи settings: одни должны выжить, другие — исчезнуть.
    const setKey = (k: string, v: string) =>
      run(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [k, v]);
    setKey('client_id', 'client-abc');
    setKey('snapshot_registry_v1', '[{"id":"snap-1"}]');
    setKey('bound_user_id', 'user-A');
    setKey('theme', 'dark');            // UI-настройка — сохраняется
    setKey('lang', 'ru');               // UI-настройка — сохраняется
    setKey('sync_last_pulled_tasks', '2026-01-01T00:00:00Z');   // курсор pull — удаляется
    setKey('sync_last_pulled_tags', '2026-01-01T00:00:00Z');    // курсор pull — удаляется

    // Санити: данные на месте до очистки (initDb мог засеять дефолтные статусы/шаблоны,
    // поэтому проверяем «есть хотя бы наши строки», а не точное число).
    expect(tableCount(all, 'tasks')).toBeGreaterThanOrEqual(1);
    expect(tableCount(all, 'tags')).toBeGreaterThanOrEqual(1);
    expect(tableCount(all, 'statuses')).toBeGreaterThanOrEqual(1);
    expect(tableCount(all, 'sync_outbox')).toBeGreaterThanOrEqual(1);

    // ── Очистка ───────────────────────────────────────────────────────────
    await clearUserData();

    // ── УДАЛЕНО: пользовательские таблицы ──────────────────────────────────
    expect(tableCount(all, 'tasks')).toBe(0);
    expect(tableCount(all, 'tags')).toBe(0);
    expect(tableCount(all, 'statuses')).toBe(0);
    expect(tableCount(all, 'task_templates')).toBe(0);
    expect(tableCount(all, 'overdue_events')).toBe(0);
    expect(tableCount(all, 'sync_outbox')).toBe(0);

    // ── УДАЛЕНО: курсоры pull (sync_last_pulled_%) ─────────────────────────
    expect(get(`SELECT value FROM settings WHERE key = 'sync_last_pulled_tasks'`)).toBeNull();
    expect(get(`SELECT value FROM settings WHERE key = 'sync_last_pulled_tags'`)).toBeNull();

    // ── СОХРАНЕНО: client_id / реестр снимков / привязка / UI ──────────────
    expect(get<{ value: string }>(`SELECT value FROM settings WHERE key = 'client_id'`)?.value).toBe('client-abc');
    expect(get<{ value: string }>(`SELECT value FROM settings WHERE key = 'snapshot_registry_v1'`)?.value).toBe('[{"id":"snap-1"}]');
    expect(get<{ value: string }>(`SELECT value FROM settings WHERE key = 'bound_user_id'`)?.value).toBe('user-A');
    expect(get<{ value: string }>(`SELECT value FROM settings WHERE key = 'theme'`)?.value).toBe('dark');
    expect(get<{ value: string }>(`SELECT value FROM settings WHERE key = 'lang'`)?.value).toBe('ru');
  });

  it('не вызывает seed: после очистки статусы НЕ пересоздаются', async () => {
    const db = await import('./db');
    const { initDb, run, all, clearUserData } = db;
    await initDb();

    run(`INSERT INTO statuses (name, color, behavior, sort_order) VALUES ('S', '#111', 'middle', 0)`);
    await clearUserData();

    // Ключевая гарантия варианта «Загрузить облачные»: база остаётся ПУСТОЙ,
    // чтобы следующий pull отдал ровно облако нового аккаунта (без seed-мусора).
    expect(tableCount(all, 'statuses')).toBe(0);
  });
});
