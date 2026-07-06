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
  it('task с неизвестным status_id пропускается (deferred)', async () => {
    const { _internals } = await import('./pull');
    // Локально нет status'а с uuid 'st-missing' → applier должен вернуть false.
    const changed = _internals.applyCloudRowTasks({
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
    });
    expect(changed).toBe(false);
    // Локальной задачи не появилось.
    const row = liveDb!.exec(`SELECT COUNT(*) FROM tasks WHERE uuid='tk-1'`)[0].values[0][0];
    expect(row).toBe(0);
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
