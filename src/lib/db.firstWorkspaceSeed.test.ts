// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
/**
 * db.firstWorkspaceSeed.test.ts — P1: сид первого (системного personal) ws.
 *
 * Баг: на десктопе (Tauri) после чистой установки и создания НОВОГО аккаунта
 * первое (системное personal) пространство НЕ содержит дефолтных статусов и
 * welcome-задачи.
 *
 * Корень: `tauriSeed()` НЕ проставляет `workspace_id` засеянным строкам
 * (в отличие от web-`seed()`), а гидрация native→webDb в `initDb()` теряет
 * колонку `workspace_id`. В итоге сид-строки получают `workspace_id = NULL`,
 * выпадают из ws-scoped выборок UI (`filterByWorkspace`) для системного ws
 * (`ws_local`, а после привязки — `ws_<uid>`), а `reconcilePersonalWorkspace`
 * их не переносит (он двигает только строки с `workspace_id = 'ws_local'`).
 *
 * Тест гоняет РЕАЛЬНЫЙ Tauri-путь db.ts, подсовывая sql.js-адаптер вместо
 * нативного @tauri-apps/plugin-sql (execute/select 1:1 повторяют SQLite).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import initSqlJs from 'sql.js';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const req = createRequire(import.meta.url);
const WASM_FILE_URL = pathToFileURL(req.resolve('sql.js/dist/sql-wasm.wasm')).href;
vi.mock('sql.js/dist/sql-wasm.wasm?url', () => ({ default: WASM_FILE_URL }));

// Держатель sql.js-бэкенда «нативной» БД: заполняется в каждом тесте до initDb.
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

/** sql.js-адаптер с интерфейсом tauri-plugin-sql (execute/select). */
async function makeNativeAdapter() {
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

async function initTauriDb() {
  (window as any).__TAURI_INTERNALS__ = {};
  H.adapter = await makeNativeAdapter();
  vi.resetModules();
  const db = await import('./db');
  await db.initDb();
  return db;
}

describe('P1: сид системного personal-пространства (Tauri)', () => {
  it('после чистой установки сид-строки привязаны к системному ws (не NULL)', async () => {
    const db = await initTauriDb();
    try {
      const personal = db.get<{ value: string }>(
        "SELECT value FROM settings WHERE key='personal_workspace_id'",
      )?.value;
      expect(personal).toBeTruthy();

      // Все 7 статусов видны в системном ws (store читает webDb).
      const scoped = db.all<{ name: string }>(
        'SELECT name FROM statuses WHERE workspace_id = ?',
        [personal],
      );
      expect(scoped.length).toBe(7);

      // Ни одной «висящей» сид-строки без workspace_id.
      const orphanStatuses = db.get<{ c: number }>(
        'SELECT COUNT(*) AS c FROM statuses WHERE workspace_id IS NULL',
      )?.c;
      expect(orphanStatuses).toBe(0);

      // Welcome-задача существует и привязана к системному ws.
      const welcome = db.get<{ workspace_id: string | null }>(
        "SELECT workspace_id FROM tasks WHERE title LIKE 'Добро пожаловать%'",
      );
      expect(welcome).not.toBeNull();
      expect(welcome!.workspace_id).toBe(personal);
    } finally {
      (window as any).__TAURI_INTERNALS__ = undefined;
    }
  });

  it('после создания аккаунта система переносит сид в ws_<uid> (reconcile)', async () => {
    const db = await initTauriDb();
    try {
      const { reconcilePersonalWorkspace, computeWorkspaceId } = await import('./sync/workspace');
      const userId = 'a1b2c3d4-0000-4000-8000-000000000001';
      const target = computeWorkspaceId(userId);

      reconcilePersonalWorkspace(userId);

      // Системный personal ws нового аккаунта содержит дефолтные статусы…
      const statuses = db.all<{ name: string }>(
        'SELECT name FROM statuses WHERE workspace_id = ?',
        [target],
      );
      expect(statuses.length).toBe(7);

      // …и welcome-задачу.
      const welcome = db.get<{ workspace_id: string | null }>(
        "SELECT workspace_id FROM tasks WHERE title LIKE 'Добро пожаловать%'",
      );
      expect(welcome!.workspace_id).toBe(target);

      // Не осталось сирот с NULL/ws_local.
      const strayStatuses = db.get<{ c: number }>(
        "SELECT COUNT(*) AS c FROM statuses WHERE workspace_id IS NULL OR workspace_id = 'ws_local'",
      )?.c;
      expect(strayStatuses).toBe(0);
    } finally {
      (window as any).__TAURI_INTERNALS__ = undefined;
    }
  });
});
