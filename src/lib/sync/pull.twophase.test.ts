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

// ── F14 симптом 1: участники shared не видны owner/editor ────────────────────
// Проход B pull'а членства по `workspace_id IN (мои ws)` должен принести строки
// со-участников того же ws. До фикса членство тянулось ТОЛЬКО по user_id=me →
// локально была лишь своя строка, MembersTab показывал одного «вас».
describe('F14 симптом 1: pull членства по workspace_id приносит со-участников', () => {
  it('editor видит и свою, и owner-строку членства того же ws', async () => {
    H.store = {
      sync_workspace_members: [
        {
          id: 'm-me', workspace_id: SHARED, user_id: ME, role: 'editor',
          invited_by: OTHER, joined_at: T, created_at: T, updated_at: T,
          deleted_at: null, version: 1, client_id: 'c',
        },
        {
          id: 'm-owner', workspace_id: SHARED, user_id: OTHER, role: 'owner',
          invited_by: OTHER, joined_at: T, created_at: T, updated_at: T,
          deleted_at: null, version: 1, client_id: 'c',
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
      sync_statuses: [], sync_tasks: [], sync_tags: [], sync_task_templates: [],
      sync_overdue_events: [], sync_task_hold_periods: [], sync_workspace_settings: [],
      sync_task_activity_log: [],
    };
    const { pullAll } = await import('./pull');
    await pullAll(ME);

    // Обе строки членства ws должны оказаться локально (проход B по workspace_id).
    const cnt = liveDb!.exec(
      `SELECT COUNT(*) FROM workspace_members WHERE workspace_id=? AND deleted_at IS NULL`,
      [SHARED],
    )[0].values[0][0];
    expect(cnt).toBe(2);

    // Строка owner-со-участника (user_id=OTHER) присутствует.
    const owner = liveDb!.exec(
      `SELECT role FROM workspace_members WHERE user_id=? AND workspace_id=?`,
      [OTHER, SHARED],
    )[0]?.values[0];
    expect(owner?.[0]).toBe('owner');
  });
});

// ── F14 симптом 3: рестарт → ws исчезают и не возвращаются ───────────────────
// Полный pull членства (от epoch, игнорируя сохранённый курсор) восстанавливает
// локально погашенную/удалённую свою строку членства даже когда per-ws курсор
// членства «в будущем». До фикса Phase 1 была инкрементальной (.gt(курсор)) →
// при будущем курсоре 0 строк → prunePhantomWorkspaces вычищал shared-ws.
describe('F14 симптом 3: полный pull членства восстанавливает ws при рестарте', () => {
  it('членство подтягивается при курсоре «в будущем» → ws не вычищается prune', async () => {
    // Локальное состояние «после прошлой сессии»: строка ws SHARED есть, но своя
    // membership-строка отсутствует (была удалена prune'ом), курсор — «в будущем».
    liveDb!.run(
      `INSERT INTO workspaces (uuid, name, kind, owner_id, sort_order, created_at, updated_at, version)
       VALUES (?,?,?,?,?,?,?,1)`,
      [SHARED, 'Команда', 'shared', OTHER, 0, T, T],
    );
    liveDb!.run(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
      [`sync_last_pulled_${PERSONAL}_sync_workspace_members`, '2999-01-01T00:00:00Z'],
    );
    H.store = {
      sync_workspace_members: [
        {
          id: 'm-me', workspace_id: SHARED, user_id: ME, role: 'editor',
          invited_by: OTHER, joined_at: T, created_at: T, updated_at: T,
          deleted_at: null, version: 1, client_id: 'c',
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
      sync_statuses: [], sync_tasks: [], sync_tags: [], sync_task_templates: [],
      sync_overdue_events: [], sync_task_hold_periods: [], sync_workspace_settings: [],
      sync_task_activity_log: [],
    };
    const { pullAll } = await import('./pull');
    await pullAll(ME);

    // Своя строка членства восстановлена, несмотря на «будущий» курсор.
    const mem = liveDb!.exec(
      `SELECT COUNT(*) FROM workspace_members WHERE workspace_id=? AND user_id=? AND deleted_at IS NULL`,
      [SHARED, ME],
    )[0].values[0][0];
    expect(mem).toBe(1);

    // ws SHARED НЕ вычищен prune (членство восстановлено ДО prunePhantomWorkspaces).
    const ws = liveDb!.exec(
      `SELECT COUNT(*) FROM workspaces WHERE uuid=? AND deleted_at IS NULL`,
      [SHARED],
    )[0].values[0][0];
    expect(ws).toBe(1);
  });
});

// ── F17 (ADR 0011): рассинхрон локального uuid членства с серверным ──────────
// При accept-invite клиент создаёт локальную membership-строку со СВОИМ
// случайным uuid, а сервер хранит СВОЙ канонический uuid для той же пары
// (workspace_id, user_id). До фикса applyCloudRowMembers матчился только по
// uuid → промах → INSERT → 2067 UNIQUE (workspace_id, user_id) → pull падал,
// prune чистил ws. После фикса fallback по паре переклеивает uuid без 2067.
describe('F17: applyCloudRowMembers переклеивает локальный uuid на серверный', () => {
  it('локальный случайный uuid ≠ серверный → одна строка, uuid стал серверным, без 2067', async () => {
    const { _internals } = await import('./pull');

    // Локальная строка членства с ЛОКАЛЬНЫМ случайным uuid для (SHARED, ME).
    liveDb!.run(
      `INSERT INTO workspace_members
        (uuid, workspace_id, user_id, role, invited_by, joined_at,
         created_at, updated_at, deleted_at, version, client_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      ['wsm_local_random', SHARED, ME, 'editor', OTHER, T, T, T, null, 1, 'c'],
    );

    // Облачная строка того же членства, но с КАНОНИЧЕСКИМ серверным uuid и
    // более свежим updated_at (сервер повысил роль до admin).
    const cloud = {
      id: 'wsm_server_canonical', workspace_id: SHARED, user_id: ME, role: 'admin',
      invited_by: OTHER, joined_at: T, created_at: T,
      updated_at: '2026-07-11T12:00:00Z', deleted_at: null, version: 2, client_id: 'c',
    };

    // Не должно бросить UNIQUE constraint failed (2067).
    expect(() => _internals.applyCloudRowMembers(cloud as any)).not.toThrow();

    // Ровно ОДНА строка на пару (SHARED, ME) — INSERT не создал дубликат.
    const cnt = liveDb!.exec(
      `SELECT COUNT(*) FROM workspace_members WHERE workspace_id=? AND user_id=?`,
      [SHARED, ME],
    )[0].values[0][0];
    expect(cnt).toBe(1);

    // uuid переклеен на серверный, роль обновлена по LWW (updated_at свежее).
    const rowAfter = liveDb!.exec(
      `SELECT uuid, role FROM workspace_members WHERE workspace_id=? AND user_id=?`,
      [SHARED, ME],
    )[0].values[0];
    expect(rowAfter[0]).toBe('wsm_server_canonical');
    expect(rowAfter[1]).toBe('admin');

    // Старый локальный uuid больше не существует.
    const oldCnt = liveDb!.exec(
      `SELECT COUNT(*) FROM workspace_members WHERE uuid='wsm_local_random'`,
    )[0].values[0][0];
    expect(oldCnt).toBe(0);
  });

  it('LWW: локальная строка свежее облака → uuid переклеен, поля НЕ перезаписаны', async () => {
    const { _internals } = await import('./pull');
    liveDb!.run(
      `INSERT INTO workspace_members
        (uuid, workspace_id, user_id, role, invited_by, joined_at,
         created_at, updated_at, deleted_at, version, client_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      ['wsm_local_random', SHARED, ME, 'admin', OTHER, T, T,
       '2026-07-20T12:00:00Z', null, 5, 'c'],
    );
    const cloud = {
      id: 'wsm_server_canonical', workspace_id: SHARED, user_id: ME, role: 'editor',
      invited_by: OTHER, joined_at: T, created_at: T,
      updated_at: '2026-07-11T12:00:00Z', deleted_at: null, version: 2, client_id: 'c',
    };
    _internals.applyCloudRowMembers(cloud as any);

    const rowAfter = liveDb!.exec(
      `SELECT uuid, role FROM workspace_members WHERE workspace_id=? AND user_id=?`,
      [SHARED, ME],
    )[0].values[0];
    // uuid всегда каноничен, но роль осталась локальной (локальное updated_at свежее).
    expect(rowAfter[0]).toBe('wsm_server_canonical');
    expect(rowAfter[1]).toBe('admin');
  });

  it('регрессия: совпадение по uuid работает как раньше (UPDATE по LWW)', async () => {
    const { _internals } = await import('./pull');
    liveDb!.run(
      `INSERT INTO workspace_members
        (uuid, workspace_id, user_id, role, invited_by, joined_at,
         created_at, updated_at, deleted_at, version, client_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      ['wsm_same', SHARED, ME, 'editor', OTHER, T, T, T, null, 1, 'c'],
    );
    const cloud = {
      id: 'wsm_same', workspace_id: SHARED, user_id: ME, role: 'admin',
      invited_by: OTHER, joined_at: T, created_at: T,
      updated_at: '2026-07-11T12:00:00Z', deleted_at: null, version: 2, client_id: 'c',
    };
    const changed = _internals.applyCloudRowMembers(cloud as any);
    expect(changed).toBe(true);

    const cnt = liveDb!.exec(
      `SELECT COUNT(*) FROM workspace_members WHERE workspace_id=? AND user_id=?`,
      [SHARED, ME],
    )[0].values[0][0];
    expect(cnt).toBe(1);
    const role = liveDb!.exec(
      `SELECT role FROM workspace_members WHERE uuid='wsm_same'`,
    )[0].values[0][0];
    expect(role).toBe('admin');
  });
});
