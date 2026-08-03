/**
 * db.f36SeedWsStamp.test.ts — Unit-тесты F36 (ADR 0028): явный ws-id для сева.
 *
 * Баг (03.08.2026, доказан на data.db пользователя): на свежем free-аккаунте
 * `ensureSeededIfEmpty()` читала `settings.personal_workspace_id` из БД, а в
 * Tauri этот указатель доезжает до нативной SQLite fire-and-forget (db.run без
 * await) — сразу после `reconcilePersonalWorkspace()` его там ещё нет. В итоге
 * 7 сид-статусов и 5 тегов штамповались placeholder'ом `ws_local`, а
 * welcome-задача (создаётся ~0.2 с позже, когда указатель уже доехал) — под
 * `ws_<uid>`. Доска рендерит колонки по статусам ТЕКУЩЕГО ws → «Задачи»
 * открывались пустыми, хотя задача и статусы в базе есть.
 *
 * Контракт после фикса:
 *   • ensureSeededIfEmpty(wsId) штампует статусы/теги переданным ws-id, даже
 *     если указателя в settings нет вовсе;
 *   • ensureWelcomeTaskIfNeeded(userId, wsId) ставит задачу в тот же ws И
 *     выбирает статус СТРОГО внутри этого ws;
 *   • без аргумента поведение прежнее (обратная совместимость).
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

const UID = '1f797943-c8b5-4a3d-8e6b-c6dc7ac18c49';
const WS = 'ws_1f797943c8b54a3d8e6bc6dc7ac18c49';

describe('F36: явный ws-id для сева и welcome-задачи', () => {
  it('ensureSeededIfEmpty(wsId): статусы и теги штампуются переданным ws, а не ws_local', async () => {
    const { initDb, all, run, clearUserData, ensureSeededIfEmpty } = await import('./db');
    await initDb();
    await clearUserData();
    // Ключевое условие бага: указателя personal_workspace_id в базе НЕТ
    // (clearUserData его удалил, а db.run из reconcile ещё не доехал).
    run(`DELETE FROM settings WHERE key IN ('personal_workspace_id','current_workspace_id')`);
    expect(all(`SELECT COUNT(*) AS c FROM statuses`)[0].c as number).toBe(0);

    const seeded = await ensureSeededIfEmpty(WS);
    expect(seeded).toBe(true);

    const local = all(`SELECT COUNT(*) AS c FROM statuses WHERE workspace_id='ws_local'`)[0].c as number;
    expect(local).toBe(0);
    const onWs = all(`SELECT COUNT(*) AS c FROM statuses WHERE workspace_id=?`, [WS])[0].c as number;
    expect(onWs).toBeGreaterThan(0);
    const tagsLocal = all(`SELECT COUNT(*) AS c FROM tags WHERE workspace_id='ws_local'`)[0].c as number;
    expect(tagsLocal).toBe(0);
    const tagsOnWs = all(`SELECT COUNT(*) AS c FROM tags WHERE workspace_id=?`, [WS])[0].c as number;
    expect(tagsOnWs).toBeGreaterThan(0);
  });

  it('ensureWelcomeTaskIfNeeded(uid, wsId): задача и её статус — в одном ws', async () => {
    const { initDb, all, run, clearUserData, ensureSeededIfEmpty, ensureWelcomeTaskIfNeeded } =
      await import('./db');
    await initDb();
    await clearUserData();
    run(`DELETE FROM settings WHERE key IN ('personal_workspace_id','current_workspace_id')`);

    await ensureSeededIfEmpty(WS);
    const created = await ensureWelcomeTaskIfNeeded(UID, WS);
    expect(created).toBe(true);

    const row = all(
      `SELECT t.workspace_id AS twid, s.workspace_id AS swid
         FROM tasks t JOIN statuses s ON s.id = t.status_id LIMIT 1`,
    )[0] as { twid: string; swid: string };
    expect(row.twid).toBe(WS);
    // Главная гарантия: статус задачи принадлежит ТОМУ ЖЕ пространству —
    // иначе задача не попадёт ни в одну колонку доски.
    expect(row.swid).toBe(WS);
  });

  it('статус найден только в чужом ws → welcome не создаётся (не оставляем осиротевшую задачу)', async () => {
    const { initDb, all, run, clearUserData, ensureSeededIfEmpty, ensureWelcomeTaskIfNeeded } =
      await import('./db');
    await initDb();
    await clearUserData();
    run(`DELETE FROM settings WHERE key IN ('personal_workspace_id','current_workspace_id')`);

    // Сев ушёл на placeholder (состояние из реальной базы пользователя).
    await ensureSeededIfEmpty('ws_local');
    run(`DELETE FROM settings WHERE key='welcome_seeded'`);

    // Просим welcome в personal-ws, где статусов нет → функция обязана
    // отказаться, а не привязаться к статусу ws_local.
    const created = await ensureWelcomeTaskIfNeeded(UID, WS);
    expect(created).toBe(false);
    expect(all(`SELECT COUNT(*) AS c FROM tasks`)[0].c as number).toBe(0);
  });

  it('обратная совместимость: без ws-id используется указатель из settings', async () => {
    const { initDb, all, run, clearUserData, ensureSeededIfEmpty } = await import('./db');
    await initDb();
    await clearUserData();
    run(
      `INSERT OR REPLACE INTO settings (key, value) VALUES ('personal_workspace_id', ?)`,
      [WS],
    );

    expect(await ensureSeededIfEmpty()).toBe(true);
    const onWs = all(`SELECT COUNT(*) AS c FROM statuses WHERE workspace_id=?`, [WS])[0].c as number;
    expect(onWs).toBeGreaterThan(0);
  });
});
