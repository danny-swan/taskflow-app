// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
/**
 * P0-тест: приглашённый участник должен подтянуть ЧУЖОЕ shared-пространство
 * (его строку `workspaces` и его задачи) после того, как серверный accept_invite
 * создал строку членства.
 *
 * Баг (подтверждён прод-пробой): pull скоупил `sync_workspaces` и все data-таблицы
 * по `.eq('user_id', me)`. В shared-ws строки принадлежат ВЛАДЕЛЬЦУ (user_id=other),
 * поэтому клиентский фильтр их отсекал — хотя серверный RLS (по членству) их отдаёт.
 * Плюс набор `workspaceIds` брался из локальной таблицы `workspaces`, куда чужой ws
 * так и не попадал (chicken-and-egg).
 *
 * Здесь мок PostgREST имитирует серверный RLS:
 *   • `.eq('user_id', me)`      → только строки, где user_id == me;
 *   • `.in('workspace_id', ids)`→ строки любых владельцев, чей workspace_id ∈ ids
 *                                 (RLS пускает участника ws — viewer+);
 *   • `.in('id', ids)`          → строки sync_workspaces с id ∈ ids.
 *
 * До фикса тест КРАСНЫЙ: чужой ws и его задача не появляются локально.
 * После фикса (двухфазный pull: членство → набор → ws/данные по workspace_id) — зелёный.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import initSqlJs, { type Database } from 'sql.js';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runMigrations, webMigrationApi } from '../migrations';

const req = createRequire(import.meta.url);
const WASM_PATH = req.resolve('sql.js/dist/sql-wasm.wasm');
const _wasmBuf = readFileSync(WASM_PATH);
const WASM_BYTES = _wasmBuf.buffer.slice(
  _wasmBuf.byteOffset,
  _wasmBuf.byteOffset + _wasmBuf.byteLength,
) as ArrayBuffer;

let liveDb: Database | null = null;

// Хранилище «облачных» строк по имени таблицы — имитация серверных данных,
// которые PostgREST отдаёт с учётом RLS. Наполняется в каждом тесте.
const H = vi.hoisted(() => ({ store: {} as Record<string, any[]> }));

vi.mock('../db', () => ({
  initDb: vi.fn(async () => {}),
  isReady: vi.fn(() => liveDb !== null),
  get: vi.fn(<T>(sql: string, params: any[] = []): T | null => {
    if (!liveDb) return null;
    const stmt = liveDb.prepare(sql);
    stmt.bind(params);
    const rows: T[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject() as T);
    stmt.free();
    return rows[0] ?? null;
  }),
  all: vi.fn(<T>(sql: string, params: any[] = []): T[] => {
    if (!liveDb) return [];
    const stmt = liveDb.prepare(sql);
    stmt.bind(params);
    const rows: T[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject() as T);
    stmt.free();
    return rows;
  }),
  run: vi.fn((sql: string, params: any[] = []) => {
    if (!liveDb) throw new Error('liveDb not initialized');
    liveDb.run(sql, params);
    return { changes: liveDb.getRowsModified(), lastInsertRowid: 0 };
  }),
  exec: vi.fn((sql: string) => {
    if (!liveDb) throw new Error('liveDb not initialized');
    liveDb.exec(sql);
  }),
  select: vi.fn(<T>(sql: string, params: any[] = []): T[] => {
    if (!liveDb) return [];
    const stmt = liveDb.prepare(sql);
    stmt.bind(params);
    const rows: T[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject() as T);
    stmt.free();
    return rows;
  }),
  execute: vi.fn(async (sql: string, params: any[] = []) => {
    if (!liveDb) throw new Error('liveDb not initialized');
    liveDb.run(sql, params);
    return { rowsAffected: liveDb.getRowsModified(), lastInsertId: 0 };
  }),
}));

vi.mock('../supabase', () => {
  function makeQuery(table: string) {
    const eqF: [string, any][] = [];
    const inF: [string, any[]][] = [];
    const gtF: [string, string][] = [];
    let orderCol = 'updated_at';
    const builder: any = {
      select() { return builder; },
      eq(col: string, val: any) { eqF.push([col, val]); return builder; },
      in(col: string, arr: any[]) { inF.push([col, arr]); return builder; },
      gt(col: string, val: string) { gtF.push([col, val]); return builder; },
      order(col: string) { orderCol = col; return builder; },
      limit() { return builder; },
      then(resolve: (v: any) => void) {
        let rows = (H.store[table] ?? []).slice();
        for (const [c, v] of eqF) rows = rows.filter(r => r[c] === v);
        for (const [c, arr] of inF) rows = rows.filter(r => arr.includes(r[c]));
        for (const [c, v] of gtF) rows = rows.filter(r => String(r[c] ?? '') > String(v));
        rows.sort((a, b) => String(a[orderCol] ?? '') < String(b[orderCol] ?? '') ? -1 : 1);
        resolve({ data: rows, error: null });
      },
    };
    return builder;
  }
  return {
    supabase: { from: (t: string) => makeQuery(t) },
    isSupabaseReachable: async () => true,
  };
});

vi.mock('../logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../sync', () => ({ scheduleAutoSync: vi.fn() }));

const ME = '11111111-2222-3333-4444-555555555555';
const OTHER = '99999999-8888-7777-6666-555555555555';
const PERSONAL = 'ws_' + ME.toLowerCase().replace(/-/g, '');
const SHARED = 'ws_sharedteam0000000000000000000';
const T = '2026-07-10T12:00:00Z';

async function setupDb(): Promise<Database> {
  const SQL = await initSqlJs({ wasmBinary: WASM_BYTES });
  const d = new SQL.Database();
  liveDb = d;
  d.exec(`
    CREATE TABLE statuses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#888',
      behavior TEXT NOT NULL DEFAULT 'middle',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_seed INTEGER NOT NULL DEFAULT 0,
      is_technical INTEGER NOT NULL DEFAULT 0,
      hidden INTEGER NOT NULL DEFAULT 0,
      default_collapsed INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#888',
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      comment TEXT NOT NULL DEFAULT '',
      tag_id INTEGER,
      status_id INTEGER NOT NULL,
      start_date TEXT,
      deadline TEXT,
      finish_date TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      sort_order INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  d.run(`INSERT INTO settings (key, value) VALUES ('bound_user_id', ?)`, [ME]);
  await runMigrations(webMigrationApi(d));
  liveDb!.run(`DELETE FROM sync_outbox`);
  return d;
}

function seedCloud() {
  // Серверные данные, которые RLS отдал бы приглашённому `me`:
  //  • его строка членства в чужом shared-ws (создана accept_invite, user_id=me);
  //  • строка чужого ws (user_id/owner_id = OTHER);
  //  • статус и задача чужого ws (user_id=OTHER, workspace_id=SHARED).
  //  • personal-ws самого me (для контроля, что личное не ломается).
  H.store = {
    sync_workspace_members: [
      {
        id: 'wsm-shared', workspace_id: SHARED, user_id: ME, role: 'editor',
        invited_by: OTHER, joined_at: T,
        created_at: T, updated_at: T, deleted_at: null, version: 1, client_id: 'c',
      },
    ],
    sync_workspaces: [
      {
        id: PERSONAL, user_id: ME, owner_id: ME, name: 'Мои задачи', kind: 'personal',
        sort_order: 0, created_at: T, updated_at: T, deleted_at: null, version: 1, client_id: 'c',
      },
      {
        id: SHARED, user_id: OTHER, owner_id: OTHER, name: 'Команда', kind: 'shared',
        sort_order: 0, created_at: T, updated_at: T, deleted_at: null, version: 1, client_id: 'c',
      },
    ],
    sync_statuses: [
      {
        id: 'st-shared', workspace_id: SHARED, user_id: OTHER, name: 'В работе',
        color: '#111', behavior: 'middle', sort_order: 0,
        is_seed: 0, is_technical: 0, hidden: 0, default_collapsed: 0,
        created_at: T, updated_at: T, deleted_at: null, version: 1, client_id: 'c',
      },
    ],
    sync_tasks: [
      {
        id: 'tk-shared', workspace_id: SHARED, user_id: OTHER, title: 'Чужая задача',
        comment: '', status_id: 'st-shared', tag_id: null,
        start_date: null, deadline: null, finish_date: null, sort_order: 0, archived: false,
        created_at: T, updated_at: T, deleted_at: null, version: 1, client_id: 'c',
      },
    ],
    sync_tags: [],
    sync_task_templates: [],
    sync_overdue_events: [],
    sync_task_hold_periods: [],
    sync_workspace_settings: [],
    sync_task_activity_log: [],
  };
}

beforeEach(async () => {
  liveDb = null;
  await setupDb();
  seedCloud();
});

describe('P0: приглашённый подтягивает чужое shared-пространство после accept', () => {
  it('pullAll вставляет строку чужого ws И его задачу локально', async () => {
    const { pullAll } = await import('./pull');
    await pullAll(ME);

    // Членство подтянулось (это работало и до фикса).
    const memCnt = liveDb!.exec(
      `SELECT COUNT(*) FROM workspace_members WHERE workspace_id=? AND user_id=? AND deleted_at IS NULL`,
      [SHARED, ME],
    )[0].values[0][0];
    expect(memCnt).toBe(1);

    // КЛЮЧЕВОЕ: строка чужого ws должна появиться локально.
    const ws = liveDb!.exec(`SELECT name, kind FROM workspaces WHERE uuid=?`, [SHARED])[0]?.values[0];
    expect(ws?.[0]).toBe('Команда');
    expect(ws?.[1]).toBe('shared');

    // КЛЮЧЕВОЕ: задача чужого ws должна появиться локально.
    const task = liveDb!.exec(`SELECT title, workspace_id FROM tasks WHERE uuid='tk-shared'`)[0]?.values[0];
    expect(task?.[0]).toBe('Чужая задача');
    expect(task?.[1]).toBe(SHARED);
  });

  it('personal-ws не ломается: своя строка ws остаётся', async () => {
    const { pullAll } = await import('./pull');
    await pullAll(ME);
    const cnt = liveDb!.exec(
      `SELECT COUNT(*) FROM workspaces WHERE uuid=? AND deleted_at IS NULL`,
      [PERSONAL],
    )[0].values[0][0];
    expect(cnt).toBe(1);
  });
});
