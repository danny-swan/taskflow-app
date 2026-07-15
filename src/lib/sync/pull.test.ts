/**
 * Unit-тесты pull worker (v0.9.35-dev.4).
 *
 * Проверяем applier'ы напрямую (через _internals):
 *   1. LWW: локально новее — cloud-строка пропущена (return false).
 *   2. LWW: cloud новее — локальная обновлена, updated_at подтянут.
 *   3. INSERT: локальной строки нет — создаётся новая с сохранением uuid.
 *   4. deleted_at из облака применяется локально (для soft-delete).
 *   5. Task с неизвестным status_id пропускается (deferred).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import initSqlJs, { type Database } from 'sql.js';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runMigrations, webMigrationApi } from '../migrations';
import { DeferRowError } from './pull';

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

async function setupDb(): Promise<Database> {
  const SQL = await initSqlJs({ wasmBinary: WASM_BYTES });
  const d = new SQL.Database();
  liveDb = d;
  // Полная baseline v1 схема (совместимая с db.ts — statuses/tasks/tags/settings/task_templates/overdue_events).
  // Плюс ALTER'ы из legacy migrate(), которые в боевом app выполняются до runMigrations().
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
  await runMigrations(webMigrationApi(d));
  liveDb!.run(`DELETE FROM sync_outbox`);
  return d;
}

function insertLocalStatus(uuid: string, name: string, updated_at: string): number {
  liveDb!.run(
    `INSERT INTO statuses (name, color, sort_order, behavior, uuid, version, client_id, updated_at)
     VALUES (?, '#111', 0, 'middle', ?, 1, 'test', ?)`,
    [name, uuid, updated_at],
  );
  return liveDb!.exec(`SELECT id FROM statuses WHERE uuid=?`, [uuid])[0].values[0][0] as number;
}

beforeEach(async () => {
  liveDb = null;
  await setupDb();
});

describe('pull worker: applier statuses', () => {
  it('LWW: локально новее — cloud пропущен', async () => {
    const { _internals } = await import('./pull');
    const localTime = '2026-07-05T12:00:00Z';
    const cloudTime = '2026-07-05T10:00:00Z';
    insertLocalStatus('st-1', 'Local', localTime);
    const changed = _internals.applyCloudRowStatuses({
      id: 'st-1',
      name: 'Cloud',
      color: '#222',
      sort_order: 0,
      is_technical: 0,
      behavior: 'active',
      hidden: 0,
      updated_at: cloudTime,
      created_at: localTime,
      deleted_at: null,
      version: 2,
      client_id: 'other',
    });
    expect(changed).toBe(false);
    // Локальное имя не поменялось.
    const row = liveDb!.exec(`SELECT name FROM statuses WHERE uuid='st-1'`)[0].values[0];
    expect(row[0]).toBe('Local');
  });

  it('LWW: cloud новее — локальная обновлена', async () => {
    const { _internals } = await import('./pull');
    const localTime = '2026-07-05T10:00:00Z';
    const cloudTime = '2026-07-05T12:00:00Z';
    insertLocalStatus('st-2', 'Local', localTime);
    const changed = _internals.applyCloudRowStatuses({
      id: 'st-2',
      name: 'Cloud',
      color: '#333',
      sort_order: 5,
      is_technical: 0,
      behavior: 'active',
      hidden: 0,
      updated_at: cloudTime,
      created_at: localTime,
      deleted_at: null,
      version: 2,
      client_id: 'other',
    });
    expect(changed).toBe(true);
    const row = liveDb!.exec(
      `SELECT name, color, sort_order, updated_at FROM statuses WHERE uuid='st-2'`,
    )[0].values[0];
    expect(row[0]).toBe('Cloud');
    expect(row[1]).toBe('#333');
    expect(row[2]).toBe(5);
    expect(row[3]).toBe(cloudTime);
  });

  it('INSERT: локальной строки нет — создаётся новая', async () => {
    const { _internals } = await import('./pull');
    const changed = _internals.applyCloudRowStatuses({
      id: 'st-new',
      name: 'NewOne',
      color: '#444',
      sort_order: 0,
      is_technical: 0,
      behavior: 'active',
      hidden: 0,
      updated_at: '2026-07-05T12:00:00Z',
      created_at: '2026-07-05T12:00:00Z',
      deleted_at: null,
      version: 1,
      client_id: 'other',
    });
    expect(changed).toBe(true);
    const row = liveDb!.exec(`SELECT name FROM statuses WHERE uuid='st-new'`)[0]?.values[0];
    expect(row?.[0]).toBe('NewOne');
  });

  it('deleted_at: cloud содержит deleted_at — локально применяется', async () => {
    const { _internals } = await import('./pull');
    const localTime = '2026-07-05T10:00:00Z';
    const cloudTime = '2026-07-05T12:00:00Z';
    insertLocalStatus('st-del', 'ToDelete', localTime);
    const changed = _internals.applyCloudRowStatuses({
      id: 'st-del',
      name: 'ToDelete',
      color: '#111',
      sort_order: 0,
      is_technical: 0,
      behavior: 'active',
      hidden: 0,
      updated_at: cloudTime,
      created_at: localTime,
      deleted_at: cloudTime,
      version: 2,
      client_id: 'other',
    });
    expect(changed).toBe(true);
    const row = liveDb!.exec(`SELECT deleted_at FROM statuses WHERE uuid='st-del'`)[0].values[0];
    expect(row[0]).toBe(cloudTime);
  });
});

describe('pull worker: applier tasks', () => {
  // v0.9.35-dev.6.10.3 — ИЗМЕНЕНО поведение (Проблема №1 синхронизации):
  // раньше задача с неизвестным status_id либо пропускалась, либо («баг #4»)
  // сваливалась в первый top-статус («Важно») — это ломало распределение задач.
  // Теперь такая задача-сирота ОТКЛАДЫВАЕТСЯ (throw DeferRowError): не вставляется
  // и НЕ попадает в «Важно»; будет перечитана на следующем pull, когда статус
  // придёт из облака.
  it('задача с неизвестным status_id ОТКЛАДЫВАЕТСЯ (DeferRowError), если статусов нет', async () => {
    const { _internals } = await import('./pull');
    // Таблица statuses пуста → задача-сирота откладывается.
    expect(() =>
      _internals.applyCloudRowTasks({
        id: 'tk-1',
        title: 'orphan task',
        comment: null,
        status_id: 'st-missing',
        tag_id: null,
        start_date: null,
        deadline: null,
        finish_date: null,
        sort_order: 0,
        archived: false,
        updated_at: '2026-07-05T12:00:00Z',
        created_at: '2026-07-05T12:00:00Z',
        deleted_at: null,
        version: 1,
        client_id: 'other',
      }),
    ).toThrow(DeferRowError);
    // Локальной задачи не появилось.
    const row = liveDb!.exec(`SELECT COUNT(*) FROM tasks WHERE uuid='tk-1'`)[0].values[0][0];
    expect(row).toBe(0);
  });

  it('задача-сирота НЕ сваливается в top-статус, даже если он есть (откат «бага #4»)', async () => {
    const { _internals } = await import('./pull');
    // Создаём top-статус локально (behavior='top', hidden=0).
    liveDb!.run(
      `INSERT INTO statuses (name, color, sort_order, behavior, hidden, uuid, version, client_id, updated_at)
       VALUES ('Top', '#111', 0, 'top', 0, 'st-top', 1, 'test', '2026-07-05T10:00:00Z')`,
    );

    // Облачная задача ссылается на несуществующий локально status_id.
    expect(() =>
      _internals.applyCloudRowTasks({
        id: 'tk-orphan',
        title: 'orphan with fallback',
        comment: '',
        status_id: 'st-does-not-exist',
        tag_id: null,
        start_date: null,
        deadline: null,
        finish_date: null,
        sort_order: 0,
        archived: false,
        updated_at: '2026-07-05T12:00:00Z',
        created_at: '2026-07-05T12:00:00Z',
        deleted_at: null,
        version: 1,
        client_id: 'other',
      }),
    ).toThrow(DeferRowError);
    // Задача НЕ вставлена ни в какой статус.
    const cnt = liveDb!.exec(`SELECT COUNT(*) FROM tasks WHERE uuid='tk-orphan'`)[0].values[0][0];
    expect(cnt).toBe(0);
  });

  it('task с известным status_id — INSERT', async () => {
    const { _internals } = await import('./pull');
    insertLocalStatus('st-parent', 'Parent', '2026-07-05T10:00:00Z');
    const changed = _internals.applyCloudRowTasks({
      id: 'tk-ok',
      title: 'ok task',
      comment: 'c',
      status_id: 'st-parent',
      tag_id: null,
      start_date: null,
      deadline: null,
      finish_date: null,
      sort_order: 0,
      archived: false,
      updated_at: '2026-07-05T12:00:00Z',
      created_at: '2026-07-05T12:00:00Z',
      deleted_at: null,
      version: 1,
      client_id: 'other',
    });
    expect(changed).toBe(true);
    const row = liveDb!.exec(`SELECT title FROM tasks WHERE uuid='tk-ok'`)[0].values[0];
    expect(row[0]).toBe('ok task');
  });

  it('last_pulled_at сохраняется через settings', async () => {
    const { _internals } = await import('./pull');
    expect(_internals.getLastPulledAt('sync_tasks')).toBe('1970-01-01T00:00:00Z');
    _internals.setLastPulledAt('sync_tasks', '2026-07-05T15:00:00Z');
    expect(_internals.getLastPulledAt('sync_tasks')).toBe('2026-07-05T15:00:00Z');
    const row = liveDb!.exec(
      `SELECT value FROM settings WHERE key='sync_last_pulled_sync_tasks'`,
    )[0].values[0];
    expect(row[0]).toBe('2026-07-05T15:00:00Z');
  });
});

/**
 * Bug #1 (фикс #1): prunePhantomWorkspaces удаляет из локального зеркала ws, где
 * у текущего пользователя нет живого членства (остатки прошлых аккаунтов), но
 * сохраняет personal-ws и shared-ws, где он состоит.
 */
describe('pull worker: prunePhantomWorkspaces (Bug #1)', () => {
  const UID = 'user-me';
  const PERSONAL = 'ws_' + UID.replace(/-/g, '');

  const insertWs = (uuid: string, kind: string) =>
    liveDb!.run(
      `INSERT INTO workspaces (uuid, name, kind, owner_id, sort_order, created_at, updated_at, version, client_id)
       VALUES (?,?,?,?,0,'2026-07-01','2026-07-01',1,'test')`,
      [uuid, uuid, kind, UID],
    );
  const insertMember = (wsId: string, userId: string, role: string, deleted_at: string | null) =>
    liveDb!.run(
      `INSERT INTO workspace_members (uuid, workspace_id, user_id, role, created_at, updated_at, deleted_at, version, client_id)
       VALUES (?,?,?,?, '2026-07-01','2026-07-01', ?, 1,'test')`,
      [`wsm_${wsId}_${userId}`, wsId, userId, role, deleted_at],
    );
  const wsUuids = (): string[] =>
    (liveDb!.exec(`SELECT uuid FROM workspaces ORDER BY uuid`)[0]?.values ?? []).map(r => r[0] as string);

  it('удаляет чужое personal-ws, сохраняет моё personal и shared с моим членством', async () => {
    const { _internals } = await import('./pull');
    // Моё personal (членство owner) + shared (я editor) + чужое personal (я не член).
    insertWs(PERSONAL, 'personal');
    insertMember(PERSONAL, UID, 'owner', null);
    insertWs('ws_shared', 'shared');
    insertMember('ws_shared', UID, 'editor', null);
    insertWs('ws_foreign', 'personal');
    insertMember('ws_foreign', 'someone-else', 'owner', null);

    const removed = _internals.prunePhantomWorkspaces(UID);
    expect(removed).toBe(1);
    // ws_local сеется миграцией и защищён allow-list'ом (local-only база).
    expect(wsUuids()).toEqual(['ws_local', 'ws_shared', PERSONAL]);
    // Членство фантома тоже вычищено.
    const memCnt = liveDb!.exec(
      `SELECT COUNT(*) FROM workspace_members WHERE workspace_id='ws_foreign'`,
    )[0].values[0][0];
    expect(memCnt).toBe(0);
  });

  it('членство с deleted_at не даёт права — ws удаляется', async () => {
    const { _internals } = await import('./pull');
    insertWs(PERSONAL, 'personal');
    insertMember(PERSONAL, UID, 'owner', null);
    insertWs('ws_left', 'shared');
    insertMember('ws_left', UID, 'editor', '2026-07-10'); // вышел из ws

    const removed = _internals.prunePhantomWorkspaces(UID);
    expect(removed).toBe(1);
    expect(wsUuids()).toEqual(['ws_local', PERSONAL]);
  });

  it('не трогает personal-ws пользователя, даже если членство ещё не подтянулось', async () => {
    const { _internals } = await import('./pull');
    // Только строка ws, членства нет (холодный старт) — personal защищён allow-list'ом.
    insertWs(PERSONAL, 'personal');

    const removed = _internals.prunePhantomWorkspaces(UID);
    expect(removed).toBe(0);
    expect(wsUuids()).toEqual(['ws_local', PERSONAL]);
  });

  it('Bug D/E: не удаляет свежесозданный shared-ws с pending outbox (ещё до первого pull)', async () => {
    const { _internals } = await import('./pull');
    insertWs(PERSONAL, 'personal');
    insertMember(PERSONAL, UID, 'owner', null);
    // Только что создан локально: строка ws есть, членства ещё нет, но ws висит
    // в sync_outbox (push не долетел). Прунить нельзя — иначе «исчезнет».
    insertWs('ws_new', 'shared');
    liveDb!.run(
      `INSERT INTO sync_outbox (entity_table, entity_uuid, op, queued_at, attempt_count)
       VALUES ('workspaces', 'ws_new', 'upsert', datetime('now'), 0)`,
    );

    const removed = _internals.prunePhantomWorkspaces(UID);
    expect(removed).toBe(0);
    expect(wsUuids()).toEqual(['ws_local', 'ws_new', PERSONAL]);
  });

  it('Bug D/E: защищает ws через pending member-строку в outbox (по join)', async () => {
    const { _internals } = await import('./pull');
    insertWs(PERSONAL, 'personal');
    insertMember(PERSONAL, UID, 'owner', null);
    // ws_m: активного членства нет в allow-list (строка soft-deleted → query её не
    // выберет), но member-uuid висит в outbox — join должен вернуть ws в allowed.
    insertWs('ws_m', 'shared');
    insertMember('ws_m', UID, 'owner', '2026-07-10'); // deleted_at → не в allow-list
    liveDb!.run(
      `INSERT INTO sync_outbox (entity_table, entity_uuid, op, queued_at, attempt_count)
       VALUES ('workspace_members', ?, 'upsert', datetime('now'), 0)`,
      [`wsm_ws_m_${UID}`],
    );

    const removed = _internals.prunePhantomWorkspaces(UID);
    expect(removed).toBe(0);
    expect(wsUuids()).toContain('ws_m');
  });
});
