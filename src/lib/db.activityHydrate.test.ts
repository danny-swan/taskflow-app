// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
/**
 * db.activityHydrate.test.ts — F19 (ADR 0013), Задача 4: гидрация
 * `task_activity_log` и `workspace_settings` из нативной data.db в webDb-зеркало
 * при рестарте (Tauri).
 *
 * Тот же класс бага, что F18 (ADR 0012): в Tauri чтение (db.get/db.all) идёт
 * ТОЛЬКО из зеркала, а initDb() заливает в свежесозданное зеркало лишь явно
 * перечисленные таблицы. `task_activity_log` (миграция v13) и
 * `workspace_settings` (v11) в этот список НЕ входили:
 *   • история изменений (TaskActivityLog / WorkspaceHistoryTab) после рестарта
 *     показывала пусто, пока не отработает следующий pull;
 *   • overdue_mode пространства молча откатывался к глобальному, а pull,
 *     матчащий по (workspace_id, key), шёл по INSERT-ветке → 2067 UNIQUE в
 *     нативной БД (ошибка проглатывалась fire-and-forget).
 *
 * Правило §11.5 арх-дока: любая таблица, которую UI/pull читает через зеркало,
 * ОБЯЗАНА гидрироваться в initDb().
 *
 * Тест гоняет РЕАЛЬНЫЙ Tauri-путь db.ts поверх sql.js-адаптера, переживающего
 * «рестарт» (по образцу db.workspaceHydrate.test.ts).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import initSqlJs from 'sql.js';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const req = createRequire(import.meta.url);
const WASM_FILE_URL = pathToFileURL(req.resolve('sql.js/dist/sql-wasm.wasm')).href;
vi.mock('sql.js/dist/sql-wasm.wasm?url', () => ({ default: WASM_FILE_URL }));

const H = vi.hoisted(() => ({ adapter: null as any }));
vi.mock('@tauri-apps/plugin-sql', () => ({ default: { load: async () => H.adapter } }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: async () => 'data.db' }));

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

async function makePersistentNativeAdapter() {
  const SQL = await initSqlJs({ locateFile: () => WASM_FILE_URL });
  const nd = new SQL.Database();
  return {
    execute: async (sql: string, params: any[] = []) => {
      nd.run(sql, params);
      return { rowsAffected: nd.getRowsModified(), lastInsertId: 0 };
    },
    select: async (sql: string, params: any[] = []) => {
      const s = nd.prepare(sql);
      s.bind(params);
      const rows: any[] = [];
      while (s.step()) rows.push(s.getAsObject());
      s.free();
      return rows;
    },
  };
}

async function bootDb() {
  (window as any).__TAURI_INTERNALS__ = {};
  vi.resetModules();
  const db = await import('./db');
  await db.initDb();
  return db;
}

const WS = 'ws_019f67531f5b750ca62574e508d2116c';
const TASK_UUID = '019f6753-1f5b-750c-a625-74e508d2116d';
const USER = '9ef5d96b-9055-4db1-b3c5-c6effc6f0cce';

describe('F19: гидрация task_activity_log / workspace_settings при рестарте (Tauri)', () => {
  it('журнал активности переживает рестарт в зеркале', async () => {
    H.adapter = await makePersistentNativeAdapter();
    await bootDb();

    // Строки журнала кладёт pull (fire-and-forget → нативная data.db).
    await H.adapter.execute(
      `INSERT INTO task_activity_log (uuid, task_id, workspace_id, user_id, kind, payload, created_at)
       VALUES (?,?,?,?,?,?,?)`,
      ['act-1', TASK_UUID, WS, USER, 'created', '{}', '2026-07-20T10:00:00.000Z'],
    );
    await H.adapter.execute(
      `INSERT INTO task_activity_log (uuid, task_id, workspace_id, user_id, kind, payload, created_at)
       VALUES (?,?,?,?,?,?,?)`,
      ['act-2', TASK_UUID, WS, USER, 'status_changed', '{"to":"Выполнено"}', '2026-07-20T11:00:00.000Z'],
    );

    (window as any).__TAURI_INTERNALS__ = undefined;

    const db2 = await bootDb();
    try {
      const rows = db2.all<{ uuid: string; kind: string; payload: string }>(
        'SELECT uuid, kind, payload FROM task_activity_log WHERE workspace_id=? ORDER BY created_at',
        [WS],
      );
      expect(rows.length).toBe(2);
      expect(rows[0].uuid).toBe('act-1');
      expect(rows[1].kind).toBe('status_changed');
      expect(rows[1].payload).toBe('{"to":"Выполнено"}');

      // Дедуп pull'а (SELECT id ... WHERE uuid=?) снова видит строку → повторный
      // pull пойдёт по «уже есть», а не по INSERT с 2067 в нативной БД.
      const byUuid = db2.get<{ id: number }>('SELECT id FROM task_activity_log WHERE uuid=?', ['act-1']);
      expect(byUuid).not.toBeNull();
    } finally {
      (window as any).__TAURI_INTERNALS__ = undefined;
    }
  });

  it('workspace_settings переживают рестарт в зеркале (overdue_mode пространства)', async () => {
    H.adapter = await makePersistentNativeAdapter();
    await bootDb();

    await H.adapter.execute(
      `INSERT INTO workspace_settings (uuid, workspace_id, key, value, created_at, updated_at, version)
       VALUES (?,?,?,?,?,?,?)`,
      ['wss-1', WS, 'overdue_mode', 'strict',
       '2026-07-20T10:00:00.000Z', '2026-07-20T10:00:00.000Z', 1],
    );

    (window as any).__TAURI_INTERNALS__ = undefined;

    const db2 = await bootDb();
    try {
      const row = db2.get<{ value: string; uuid: string }>(
        `SELECT value, uuid FROM workspace_settings WHERE workspace_id=? AND key='overdue_mode'`,
        [WS],
      );
      expect(row).not.toBeNull();
      expect(row!.value).toBe('strict');
      expect(row!.uuid).toBe('wss-1');
    } finally {
      (window as any).__TAURI_INTERNALS__ = undefined;
    }
  });
});
