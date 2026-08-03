// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
/**
 * db.workspaceHydrate.test.ts — F18 (ADR 0012): гидрация workspaces +
 * workspace_members из нативной data.db в webDb-зеркало при рестарте (Tauri).
 *
 * ИСТИННЫЙ КОРЕНЬ «shared-пространства пропадают после рестарта»:
 * в Tauri запись идёт синхронно в webDb-зеркало (sql.js) и fire-and-forget в
 * нативную data.db; чтение (db.get/db.all) — ТОЛЬКО из зеркала. При перезапуске
 * initDb() создаёт ПУСТОЕ зеркало и заливает в него из нативной БД лишь часть
 * таблиц. РАНЬШЕ `workspaces` и `workspace_members` в этот hydrate НЕ входили →
 * после рестарта зеркало было ПУСТЫМ по членству → applyCloudRowMembers не
 * находил существующую строку → INSERT → 2067 UNIQUE в нативной data.db →
 * prunePhantomWorkspaces сносил shared-ws → пустой сайдбар.
 *
 * F14–F17 чинили СИМПТОМ (matcher/uuid/corruption) поверх пустого зеркала и
 * потому не могли помочь. F18 добавляет недостающую гидрацию (правило §11.3
 * арх-дока: любая ws-scoped таблица ОБЯЗАНА гидрироваться на обоих путях).
 *
 * Тест гоняет РЕАЛЬНЫЙ Tauri-путь db.ts с sql.js-адаптером вместо нативного
 * @tauri-apps/plugin-sql, ПЕРЕЖИВАЮЩИМ «рестарт» (тот же файл БД).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import initSqlJs from 'sql.js';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const req = createRequire(import.meta.url);
const WASM_FILE_URL = pathToFileURL(req.resolve('sql.js/dist/sql-wasm.wasm')).href;
vi.mock('sql.js/dist/sql-wasm.wasm?url', () => ({ default: WASM_FILE_URL }));

// Держатель ПЕРСИСТЕНТНОГО sql.js-бэкенда «нативной» БД: НЕ пересоздаётся между
// «рестартами», чтобы данные (как реальный data.db) переживали перезапуск.
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

/** sql.js-адаптер с интерфейсом tauri-plugin-sql (execute/select). Персистентный. */
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

/** Загружает свежий модуль db.ts и вызывает initDb() поверх текущего адаптера. */
async function bootDb() {
  (window as any).__TAURI_INTERNALS__ = {};
  vi.resetModules();
  const db = await import('./db');
  await db.initDb();
  return db;
}

describe('F18: гидрация workspaces/workspace_members при рестарте (Tauri)', () => {
  it('shared-membership в нативной БД переживает рестарт в зеркале (нет пустого зеркала → нет 2067)', async () => {
    // Один персистентный «data.db» на весь тест — переживает оба запуска.
    H.adapter = await makePersistentNativeAdapter();

    // --- Первый запуск: чистая установка ---
    const db1 = await bootDb();

    // Эмулируем принятое приглашение: shared-ws + membership с СЕРВЕРНЫМ uuid
    // записаны в нативную data.db (в реальности — fire-and-forget из db.run).
    const wsUuid = 'ws_019f67531f5b750ca62574e508d2116c';
    const userId = '9ef5d96b-9055-4db1-b3c5-c6effc6f0cce';
    const serverMemberUuid = 'wsm_77cf64e183584081b1803e68b83f9b30';
    await H.adapter.execute(
      `INSERT INTO workspaces (uuid, name, kind, owner_id, sort_order, created_at, updated_at, version)
       VALUES (?,?,?,?,?,?,?,?)`,
      [wsUuid, '123', 'shared', 'fc592c97-b640-4a49-8e94-10229733ec58', 1,
       '2026-07-20T10:00:00.000Z', '2026-07-20T10:00:00.000Z', 1],
    );
    await H.adapter.execute(
      `INSERT INTO workspace_members (uuid, workspace_id, user_id, role, joined_at, created_at, updated_at, version)
       VALUES (?,?,?,?,?,?,?,?)`,
      [serverMemberUuid, wsUuid, userId, 'editor',
       '2026-07-20T10:00:00.000Z', '2026-07-20T10:00:00.000Z', '2026-07-20T10:00:00.000Z', 1],
    );

    // Проверяем, что в нативной БД строки действительно есть.
    const nativeMembers = await H.adapter.select(
      'SELECT uuid, workspace_id, user_id FROM workspace_members WHERE workspace_id=?',
      [wsUuid],
    );
    expect(nativeMembers.length).toBe(1);

    (window as any).__TAURI_INTERNALS__ = undefined;

    // --- Рестарт: новый модуль/зеркало поверх ТОГО ЖЕ нативного адаптера ---
    const db2 = await bootDb();
    try {
      // РЕГРЕССИЯ F18: после рестарта зеркало (webDb) ДОЛЖНО содержать shared
      // membership и ws. До фикса эти таблицы не гидрировались → было бы 0 строк.
      const mirrorMember = db2.get<{ uuid: string; user_id: string; role: string }>(
        'SELECT uuid, user_id, role FROM workspace_members WHERE workspace_id=?',
        [wsUuid],
      );
      expect(mirrorMember).not.toBeNull();
      expect(mirrorMember!.uuid).toBe(serverMemberUuid);
      expect(mirrorMember!.user_id).toBe(userId);
      expect(mirrorMember!.role).toBe('editor');

      const mirrorWs = db2.get<{ uuid: string; kind: string; name: string }>(
        'SELECT uuid, kind, name FROM workspaces WHERE uuid=?',
        [wsUuid],
      );
      expect(mirrorWs).not.toBeNull();
      expect(mirrorWs!.kind).toBe('shared');
      expect(mirrorWs!.name).toBe('123');

      // Инвариант, который ломал 2067: серверный uuid членства теперь ВИДЕН
      // matcher'у (SELECT WHERE workspace_id/user_id находит строку) → apply
      // пойдёт по UPDATE-ветке, а не INSERT.
      const byPair = db2.get<{ uuid: string }>(
        'SELECT uuid FROM workspace_members WHERE workspace_id=? AND user_id=?',
        [wsUuid, userId],
      );
      expect(byPair).not.toBeNull();
      expect(byPair!.uuid).toBe(serverMemberUuid);
    } finally {
      (window as any).__TAURI_INTERNALS__ = undefined;
    }
    void db1;
  });
});
