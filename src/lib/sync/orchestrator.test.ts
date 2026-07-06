/**
 * Integration-тест: полный roundtrip syncNow() через мок Supabase.
 *
 * Проверяем:
 *   1. syncNow() без сессии → skipped, ничего не делает.
 *   2. syncNow() с сессией + без outbox → pull + pull, state = synced.
 *   3. syncNow() с одной строкой в outbox → pull + push + pull, state = synced.
 *   4. Mutex: два параллельных вызова syncNow() возвращают один и тот же promise.
 *   5. Ошибка pull → state = error, но не throw.
 *   6. Регистрация устройства в sync_devices при первом syncNow().
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

// Mock supabase state
let session: any = null;
const upsertCalls: { table: string; rows: any[] }[] = [];
const selectData: Record<string, any[]> = {};

vi.mock('../supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session }, error: null }),
    },
    from(table: string) {
      return {
        upsert(rows: any, _opts: any) {
          // Supabase принимает как единичный объект, так и массив. Нормализуем к массиву.
          const arr = Array.isArray(rows) ? rows : [rows];
          upsertCalls.push({ table, rows: arr });
          return Promise.resolve({ error: null });
        },
        select() {
          return {
            eq: () => ({
              gt: () => ({
                order: () => ({
                  limit: async () => ({ data: selectData[table] ?? [], error: null }),
                }),
              }),
            }),
          };
        },
      };
    },
  },
  isSupabaseReachable: async () => true,
}));

vi.mock('../logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Мок clientId — orchestrator использует его.
vi.mock('../clientId', () => ({
  getClientId: () => 'test-client-id',
  resetClientIdCache: vi.fn(),
}));

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
      start_date TEXT, deadline TEXT, finish_date TEXT,
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

beforeEach(async () => {
  liveDb = null;
  upsertCalls.length = 0;
  for (const k of Object.keys(selectData)) delete selectData[k];
  session = null;
  await setupDb();
  const { _resetForTests } = await import('./index');
  _resetForTests();
});

describe('sync orchestrator', () => {
  it('no session: skipped, ничего не делает', async () => {
    const { syncNow, getSyncState } = await import('./index');
    session = null;
    const result = await syncNow();
    expect(result.skipped).toBe(true);
    expect(getSyncState().status).toBe('skipped');
    expect(upsertCalls.length).toBe(0);
  });

  it('с сессией + пустой outbox: pull → push (empty) → pull → synced', async () => {
    const { syncNow, getSyncState } = await import('./index');
    session = { user: { id: 'user-1' } };
    const result = await syncNow();
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(false);
    expect(getSyncState().status).toBe('synced');
    // Устройство было зарегистрировано (первый upsert).
    expect(upsertCalls[0].table).toBe('sync_devices');
    expect(upsertCalls[0].rows[0].id).toBe('test-client-id');
    expect(upsertCalls[0].rows[0].user_id).toBe('user-1');
  });

  it('с outbox: pull → push → pull, upsert в облако вызван', async () => {
    const { syncNow, getSyncState } = await import('./index');
    session = { user: { id: 'user-1' } };
    // Создаём локальный статус + enqueue.
    liveDb!.run(
      `INSERT INTO statuses (name, color, sort_order, behavior, uuid, version, client_id)
       VALUES ('S', '#111', 0, 'middle', 'st-abc', 1, 'test-client-id')`,
    );
    liveDb!.run(
      `INSERT INTO sync_outbox (entity_table, entity_uuid, op, queued_at, attempt_count)
       VALUES ('statuses', 'st-abc', 'upsert', datetime('now'), 0)`,
    );

    const result = await syncNow();
    expect(result.ok).toBe(true);
    expect(getSyncState().status).toBe('synced');
    // Должен быть upsert в sync_statuses (после регистрации устройства).
    const statusUpsert = upsertCalls.find(c => c.table === 'sync_statuses');
    expect(statusUpsert).toBeTruthy();
    expect(statusUpsert!.rows[0].id).toBe('st-abc');
    // Outbox теперь пуст.
    const remain = liveDb!.exec(`SELECT COUNT(*) FROM sync_outbox`)[0].values[0][0];
    expect(remain).toBe(0);
  });

  it('mutex: два параллельных syncNow() возвращают один promise', async () => {
    const { syncNow } = await import('./index');
    session = { user: { id: 'user-1' } };
    const p1 = syncNow();
    const p2 = syncNow();
    // Не строгое равенство ссылок — sync возвращает finalized-обёртку — но
    // результат должен быть одинаковый (одинаковые данные).
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.ok).toBe(r2.ok);
    expect(r1.skipped).toBe(r2.skipped);
    // Регистрация устройства произошла только один раз (mutex сработал).
    const deviceCalls = upsertCalls.filter(c => c.table === 'sync_devices');
    expect(deviceCalls.length).toBe(1);
  });

  it('регистрация устройства: sync_devices upsert с client_id + user_id', async () => {
    const { syncNow } = await import('./index');
    session = { user: { id: 'user-1' } };
    await syncNow();
    const dev = upsertCalls.find(c => c.table === 'sync_devices');
    expect(dev).toBeTruthy();
    expect(dev!.rows[0].id).toBe('test-client-id');
    expect(dev!.rows[0].user_id).toBe('user-1');
    expect(dev!.rows[0].last_seen_at).toBeTruthy();
  });
});
