// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
/**
 * Unit-тесты sync-конвейера для workspaces (Wave A, PR-2 «Sync»).
 *
 * Покрываем 4 шва:
 *   (a) pull-appliers шести старых таблиц проставляют workspace_id (не NULL);
 *   (b) toCloud-мапперы шести таблиц включают workspace_id;
 *   (c) резолверы status/tag учитывают workspace_id (скоуп по пространству);
 *   (d) три новые ws-сущности round-trip (toCloud) + pull-appliers;
 *   (e) реконсиляция ws_local → ws_<uid> (reconcilePersonalWorkspace);
 *   (f) мягкая миграция ключа курсора (legacy → per-ws).
 *
 * Harness — sql.js in-memory + реальные миграции (как в pull.test.ts).
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

vi.mock('../supabase', () => ({
  supabase: { from: () => ({}), auth: { getSession: async () => ({ data: {}, error: null }) } },
  isSupabaseReachable: async () => true,
}));

vi.mock('../logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// enqueueOutbox тянет './sync' лениво — мокаем, чтобы не грузить оркестратор.
vi.mock('../sync', () => ({ scheduleAutoSync: vi.fn() }));

const USER_ID = '11111111-2222-3333-4444-555555555555';
const WS = 'ws_' + USER_ID.toLowerCase().replace(/-/g, '');

async function setupDb(bound: boolean): Promise<Database> {
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
  if (bound) {
    d.run(`INSERT INTO settings (key, value) VALUES ('bound_user_id', ?)`, [USER_ID]);
  }
  await runMigrations(webMigrationApi(d));
  liveDb!.run(`DELETE FROM sync_outbox`);
  return d;
}

// ─── (a) pull-appliers шести таблиц проставляют workspace_id ──────────────────

describe('(a) pull appliers проставляют workspace_id', () => {
  beforeEach(async () => {
    liveDb = null;
    await setupDb(true);
  });

  it('applyCloudRowStatuses → workspace_id из облака', async () => {
    const { _internals } = await import('./pull');
    _internals.applyCloudRowStatuses({
      id: 'st-a', name: 'S', color: '#111', behavior: 'middle', sort_order: 0,
      is_seed: 0, is_technical: 0, hidden: 0, default_collapsed: 0,
      updated_at: '2026-07-05T12:00:00Z', created_at: '2026-07-05T12:00:00Z',
      deleted_at: null, version: 1, client_id: 'c', workspace_id: WS,
    } as any);
    const ws = liveDb!.exec(`SELECT workspace_id FROM statuses WHERE uuid='st-a'`)[0].values[0][0];
    expect(ws).toBe(WS);
  });

  it('applyCloudRowTasks → workspace_id из облака', async () => {
    const { _internals } = await import('./pull');
    _internals.applyCloudRowStatuses({
      id: 'st-parent', name: 'P', color: '#111', behavior: 'middle', sort_order: 0,
      is_seed: 0, is_technical: 0, hidden: 0, default_collapsed: 0,
      updated_at: '2026-07-05T10:00:00Z', created_at: '2026-07-05T10:00:00Z',
      deleted_at: null, version: 1, client_id: 'c', workspace_id: WS,
    } as any);
    _internals.applyCloudRowTasks({
      id: 'tk-a', title: 'T', comment: '', status_id: 'st-parent', tag_id: null,
      start_date: null, deadline: null, finish_date: null, sort_order: 0, archived: false,
      updated_at: '2026-07-05T12:00:00Z', created_at: '2026-07-05T12:00:00Z',
      deleted_at: null, version: 1, client_id: 'c', workspace_id: WS,
    } as any);
    const ws = liveDb!.exec(`SELECT workspace_id FROM tasks WHERE uuid='tk-a'`)[0].values[0][0];
    expect(ws).toBe(WS);
  });

  it('applyCloudRowTags → workspace_id из облака', async () => {
    const { _internals } = await import('./pull');
    _internals.applyCloudRowTags({
      id: 'tg-a', name: 'G', color: '#111', sort_order: 0,
      updated_at: '2026-07-05T12:00:00Z', created_at: '2026-07-05T12:00:00Z',
      deleted_at: null, version: 1, client_id: 'c', workspace_id: WS,
    } as any);
    const ws = liveDb!.exec(`SELECT workspace_id FROM tags WHERE uuid='tg-a'`)[0].values[0][0];
    expect(ws).toBe(WS);
  });
});

// ─── (b) toCloud-мапперы включают workspace_id ────────────────────────────────

describe('(b) toCloud мапперы включают workspace_id', () => {
  beforeEach(async () => {
    liveDb = null;
    await setupDb(true);
  });

  it('taskToCloudPayload / statusToCloudPayload / tagToCloudPayload несут workspace_id', async () => {
    const m = await import('./mappers');
    const status = m.statusToCloudPayload(
      { id: 1, uuid: 'st', name: 'S', color: '#1', behavior: 'middle', sort_order: 0,
        is_seed: 0, is_technical: 0, hidden: 0, default_collapsed: 0,
        updated_at: 't', deleted_at: null, version: 1, client_id: 'c', workspace_id: WS } as any,
      USER_ID, 'c',
    );
    expect(status.workspace_id).toBe(WS);

    const tag = m.tagToCloudPayload(
      { id: 1, uuid: 'tg', name: 'G', color: '#1', sort_order: 0,
        updated_at: 't', deleted_at: null, version: 1, client_id: 'c', workspace_id: WS } as any,
      USER_ID, 'c',
    );
    expect(tag.workspace_id).toBe(WS);

    const task = m.taskToCloudPayload(
      { id: 1, uuid: 'tk', title: 'T', comment: '', status_id: 1, tag_id: null,
        start_date: null, deadline: null, finish_date: null, sort_order: 0, archived: 0,
        created_at: 't', updated_at: 't', deleted_at: null, version: 1,
        client_id: 'c', workspace_id: WS } as any,
      USER_ID, 'c',
    );
    expect(task.workspace_id).toBe(WS);
  });
});

// ─── (c) резолверы учитывают workspace_id ─────────────────────────────────────

describe('(c) резолверы status/tag скоупятся по workspace_id', () => {
  beforeEach(async () => {
    liveDb = null;
    await setupDb(true);
  });

  it('resolveStatusUuid/resolveStatusIdByUuid уважают workspace_id', async () => {
    const m = await import('./mappers');
    // Один и тот же локальный id статуса, но в другом ws — не должен резолвиться.
    liveDb!.run(
      `INSERT INTO statuses (name, color, sort_order, behavior, uuid, version, client_id, updated_at, workspace_id)
       VALUES ('S','#1',0,'middle','st-x',1,'c','t',?)`,
      [WS],
    );
    const id = liveDb!.exec(`SELECT id FROM statuses WHERE uuid='st-x'`)[0].values[0][0] as number;

    // В своём ws — находим.
    expect(m.resolveStatusUuid(id, WS)).toBe('st-x');
    expect(m.resolveStatusIdByUuid('st-x', WS)).toBe(id);
    // В чужом ws — не находим.
    expect(m.resolveStatusUuid(id, 'ws_other')).toBeNull();
    expect(m.resolveStatusIdByUuid('st-x', 'ws_other')).toBeNull();
  });
});

// ─── (d) три новые ws-сущности round-trip + appliers ──────────────────────────

describe('(d) ws-сущности: toCloud + pull applier', () => {
  beforeEach(async () => {
    liveDb = null;
    await setupDb(true);
  });

  it('workspaceToCloudPayload: owner==user, id==uuid', async () => {
    const m = await import('./mappers');
    const p = m.workspaceToCloudPayload(
      { id: 1, uuid: WS, name: 'Мои задачи', kind: 'personal', owner_id: null,
        sort_order: 0, created_at: 't', updated_at: 't', deleted_at: null,
        version: 1, client_id: null } as any,
      USER_ID, 'cid',
    );
    expect(p.id).toBe(WS);
    expect(p.user_id).toBe(USER_ID);
    expect(p.owner_id).toBe(USER_ID);
    expect(p.client_id).toBe('cid');
  });

  it('settingToCloudPayload: без id/user_id, PK=(workspace_id,key)', async () => {
    const m = await import('./mappers');
    const p = m.settingToCloudPayload(
      { id: 1, uuid: 'u', workspace_id: WS, key: 'overdue_mode', value: 'calendar',
        created_at: 't', updated_at: 't', deleted_at: null, version: 1, client_id: 'c' } as any,
      USER_ID, 'cid',
    );
    expect(p).not.toHaveProperty('id');
    expect(p).not.toHaveProperty('user_id');
    expect(p.workspace_id).toBe(WS);
    expect(p.key).toBe('overdue_mode');
  });

  it('applyCloudRowWorkspaces: INSERT + LWW update', async () => {
    const { _internals } = await import('./pull');
    // Удаляем возможную v11-строку, чтобы протестировать чистый INSERT.
    liveDb!.run(`DELETE FROM workspaces`);
    const changed = _internals.applyCloudRowWorkspaces({
      id: WS, name: 'Cloud WS', kind: 'personal', owner_id: USER_ID, sort_order: 0,
      created_at: 't', updated_at: '2026-07-05T12:00:00Z', deleted_at: null,
      version: 1, client_id: 'c',
    } as any);
    expect(changed).toBe(true);
    const row = liveDb!.exec(`SELECT name, owner_id FROM workspaces WHERE uuid=?`, [WS])[0].values[0];
    expect(row[0]).toBe('Cloud WS');
    expect(row[1]).toBe(USER_ID);

    // LWW: старее — пропускаем.
    const again = _internals.applyCloudRowWorkspaces({
      id: WS, name: 'Older', kind: 'personal', owner_id: USER_ID, sort_order: 0,
      created_at: 't', updated_at: '2026-07-05T09:00:00Z', deleted_at: null,
      version: 1, client_id: 'c',
    } as any);
    expect(again).toBe(false);
  });

  it('applyCloudRowSettings: matched по (workspace_id,key), генерит uuid', async () => {
    const { _internals } = await import('./pull');
    liveDb!.run(`DELETE FROM workspace_settings`);
    const changed = _internals.applyCloudRowSettings({
      workspace_id: WS, key: 'overdue_mode', value: 'age',
      created_at: 't', updated_at: '2026-07-05T12:00:00Z', deleted_at: null,
      version: 1, client_id: 'c',
    } as any);
    expect(changed).toBe(true);
    const row = liveDb!.exec(
      `SELECT value, uuid FROM workspace_settings WHERE workspace_id=? AND key='overdue_mode'`,
      [WS],
    )[0].values[0];
    expect(row[0]).toBe('age');
    expect(String(row[1]).length).toBeGreaterThan(0); // uuid сгенерирован
  });
});

// ─── (e) реконсиляция ws_local → ws_<uid> ─────────────────────────────────────

describe('(e) reconcilePersonalWorkspace: ws_local → ws_<uid>', () => {
  it('переименовывает local-only пространство и его дочерние строки', async () => {
    liveDb = null;
    await setupDb(false); // НЕ привязана → v11 создаёт ws_local
    const { reconcilePersonalWorkspace, LOCAL_WS_ID } = await import('./workspace');

    // v11 должна была создать ws_local и проставить его дочерним строкам.
    const before = liveDb!.exec(`SELECT uuid FROM workspaces`)[0].values[0][0];
    expect(before).toBe(LOCAL_WS_ID);

    // Добавим локальную задачу под ws_local.
    liveDb!.run(
      `INSERT INTO statuses (name, color, sort_order, behavior, uuid, version, client_id, updated_at, workspace_id)
       VALUES ('S','#1',0,'middle','st-1',1,'c','t','ws_local')`,
    );

    const did = reconcilePersonalWorkspace(USER_ID);
    expect(did).toBe(true);

    // ws переименовано.
    const wsRow = liveDb!.exec(`SELECT uuid, owner_id FROM workspaces`)[0].values[0];
    expect(wsRow[0]).toBe(WS);
    expect(wsRow[1]).toBe(USER_ID);
    // ws_local не осталось нигде.
    expect(liveDb!.exec(`SELECT COUNT(*) FROM workspaces WHERE uuid='ws_local'`)[0].values[0][0]).toBe(0);
    // Дочерняя строка перенесена.
    const stWs = liveDb!.exec(`SELECT workspace_id FROM statuses WHERE uuid='st-1'`)[0].values[0][0];
    expect(stWs).toBe(WS);
    // Членство получило детерминированный uuid и user_id.
    const member = liveDb!.exec(
      `SELECT uuid, user_id, workspace_id FROM workspace_members`,
    )[0].values[0];
    expect(member[0]).toBe('wsm_' + USER_ID.toLowerCase().replace(/-/g, ''));
    expect(member[1]).toBe(USER_ID);
    expect(member[2]).toBe(WS);
    // Указатели в settings обновлены.
    const cur = liveDb!.exec(
      `SELECT value FROM settings WHERE key='current_workspace_id'`,
    )[0].values[0][0];
    expect(cur).toBe(WS);
    // Outbox получил ws-сущности.
    const obTables = liveDb!.exec(`SELECT DISTINCT entity_table FROM sync_outbox`)[0]?.values.map(r => r[0]) ?? [];
    expect(obTables).toContain('workspaces');
    expect(obTables).toContain('workspace_members');
  });

  it('идемпотентно: повторный вызов на уже привязанной базе — no-op (false)', async () => {
    liveDb = null;
    await setupDb(true); // привязана → v11 сразу под ws_<uid>
    const { reconcilePersonalWorkspace } = await import('./workspace');
    expect(reconcilePersonalWorkspace(USER_ID)).toBe(false);
  });

  it('current указывает на чужой ws (нет членства) → переставляет на ws_<uid>', async () => {
    liveDb = null;
    await setupDb(true); // привязана под USER_ID, v11 → current = ws_<uid>
    const { reconcilePersonalWorkspace } = await import('./workspace');

    // Симулируем залипание: указатель на пространство прошлого аккаунта, где у
    // текущего пользователя НЕТ членства (причина B из диагностики).
    const FOREIGN_WS = 'ws_foreignaccount000000000000000';
    liveDb!.run(
      `INSERT INTO workspaces (uuid, name, kind, sort_order, created_at, updated_at, version)
       VALUES (?, 'Foreign', 'personal', 0, 't', 't', 1)`,
      [FOREIGN_WS],
    );
    liveDb!.run(
      `INSERT OR REPLACE INTO settings (key, value) VALUES ('current_workspace_id', ?)`,
      [FOREIGN_WS],
    );

    const did = reconcilePersonalWorkspace(USER_ID);
    expect(did).toBe(true);

    // Указатель переставлен на personal-ws текущего пользователя.
    const cur = liveDb!.exec(
      `SELECT value FROM settings WHERE key='current_workspace_id'`,
    )[0].values[0][0];
    expect(cur).toBe(WS);
    // personal_workspace_id тоже гарантированно на ws_<uid>.
    const personal = liveDb!.exec(
      `SELECT value FROM settings WHERE key='personal_workspace_id'`,
    )[0].values[0][0];
    expect(personal).toBe(WS);
    // Идемпотентность: повторный вызов уже не меняет ничего.
    expect(reconcilePersonalWorkspace(USER_ID)).toBe(false);
  });

  it('НЕ трогает current, если у пользователя есть членство в выбранном shared-ws (Wave B)', async () => {
    liveDb = null;
    await setupDb(true);
    const { reconcilePersonalWorkspace } = await import('./workspace');

    // Пользователь сам выбрал shared-ws, где у него есть валидное членство.
    const SHARED_WS = 'ws_sharedteam0000000000000000000';
    liveDb!.run(
      `INSERT INTO workspaces (uuid, name, kind, sort_order, created_at, updated_at, version)
       VALUES (?, 'Team', 'shared', 0, 't', 't', 1)`,
      [SHARED_WS],
    );
    liveDb!.run(
      `INSERT INTO workspace_members (uuid, workspace_id, user_id, role, joined_at, created_at, updated_at, version)
       VALUES ('wsm-shared', ?, ?, 'editor', 't', 't', 't', 1)`,
      [SHARED_WS, USER_ID],
    );
    liveDb!.run(
      `INSERT OR REPLACE INTO settings (key, value) VALUES ('current_workspace_id', ?)`,
      [SHARED_WS],
    );

    // personal_workspace_id уже = ws_<uid> (v11), current — валидный shared → no-op.
    expect(reconcilePersonalWorkspace(USER_ID)).toBe(false);
    const cur = liveDb!.exec(
      `SELECT value FROM settings WHERE key='current_workspace_id'`,
    )[0].values[0][0];
    expect(cur).toBe(SHARED_WS);
  });
});

// ─── (f) мягкая миграция ключа курсора ────────────────────────────────────────

describe('(f) курсор: мягкая миграция legacy-ключа в per-ws формат', () => {
  beforeEach(async () => {
    liveDb = null;
    await setupDb(true);
  });

  it('legacy sync_last_pulled_<t> читается как per-ws и переписывается', async () => {
    const { _internals } = await import('./pull');
    // Пишем legacy-ключ вручную.
    liveDb!.run(
      `INSERT INTO settings (key, value) VALUES ('sync_last_pulled_sync_tasks', '2026-07-05T15:00:00Z')`,
    );
    // Чтение с ws → возвращает legacy-значение...
    const v = _internals.getLastPulledAt('sync_tasks', 'updated_at', WS);
    expect(v).toBe('2026-07-05T15:00:00Z');
    // ...и сразу переписывает в per-ws ключ.
    const perWs = liveDb!.exec(
      `SELECT value FROM settings WHERE key=?`,
      [_internals.lastPulledKey('sync_tasks', WS)],
    )[0].values[0][0];
    expect(perWs).toBe('2026-07-05T15:00:00Z');
  });

  it('без ws — legacy-ключ (обратная совместимость)', async () => {
    const { _internals } = await import('./pull');
    expect(_internals.lastPulledKey('sync_tasks')).toBe('sync_last_pulled_sync_tasks');
    expect(_internals.lastPulledKey('sync_tasks', WS)).toBe(`sync_last_pulled_${WS}_sync_tasks`);
  });
});
