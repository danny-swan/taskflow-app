/**
 * paywall-bootstrap.test.ts — Fix 1 (fix-round2): split paywall-гейта.
 *
 * Контракт (продуктовая модель):
 *   • free-план = ЛОКАЛЬНОЕ personal-пространство + welcome + базовый справочник,
 *     полностью офлайн; БЕЗ сети (pull/push/realtime) и без shared-ws;
 *   • pro/trial = то же + облачная синхронизация.
 *
 * Гейт режет ТОЛЬКО сеть. Локальный bootstrap (reconcilePersonalWorkspace +
 * ensureSeededIfEmpty + ensureWelcomeTaskIfNeeded + локальная привязка базы к
 * аккаунту) обязан выполняться на ЛЮБОМ плане, ДО гейта.
 *
 * Проверяем:
 *   1. free: syncNow() → state='paywalled', reconcile/seed/welcome вызваны,
 *      bound_user_id проставлен, НО НИ ОДНОГО сетевого upsert (нет push/девайса).
 *   2. pro: тот же вызов доходит до полноценного sync (регистрация устройства +
 *      state='synced') — сеть НЕ заблокирована.
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

const ensureSeededIfEmpty = vi.fn(async () => false);
const ensureWelcomeTaskIfNeeded = vi.fn(async (_userId?: string) => true);

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
  save: vi.fn(() => {}),
  isTauri: vi.fn(() => false),
  ensureSeededIfEmpty: () => ensureSeededIfEmpty(),
  ensureWelcomeTaskIfNeeded: (u?: string) => ensureWelcomeTaskIfNeeded(u),
}));

// reconcilePersonalWorkspace — шпион (реальная логика трогает store/schema).
const reconcilePersonalWorkspace = vi.fn();
vi.mock('./workspace', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./workspace')>();
  return {
    ...actual,
    reconcilePersonalWorkspace: (...a: any[]) => reconcilePersonalWorkspace(...(a as [string])),
  };
});

let session: any = null;
const upsertCalls: { table: string; rows: any[] }[] = [];

vi.mock('../supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session }, error: null }) },
    from(table: string) {
      return {
        upsert(rows: any, _opts: any) {
          upsertCalls.push({ table, rows: Array.isArray(rows) ? rows : [rows] });
          return Promise.resolve({ error: null });
        },
        select() {
          const chain = {
            gt: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }),
          };
          return { eq: () => chain, in: () => chain };
        },
      };
    },
  },
  isSupabaseReachable: async () => true,
}));

vi.mock('../logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../clientId', () => ({
  getClientId: () => 'test-client-id',
  resetClientIdCache: vi.fn(),
}));

// Управляемый план: free по умолчанию, отдельный тест поднимает pro.
let planIsPro = false;
vi.mock('../entitlements', () => ({
  getEntitlement: async () => ({ effectivePlan: planIsPro ? 'pro' : 'free' }),
  isProOrTrial: () => planIsPro,
  isPro: () => planIsPro,
  readCachedRow: () => null,
  writeCachedRow: () => {},
}));

async function setupDb(): Promise<Database> {
  const SQL = await initSqlJs({ wasmBinary: WASM_BYTES });
  const d = new SQL.Database();
  liveDb = d;
  d.exec(`
    CREATE TABLE statuses (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#888', behavior TEXT NOT NULL DEFAULT 'middle',
      sort_order INTEGER NOT NULL DEFAULT 0, is_seed INTEGER NOT NULL DEFAULT 0,
      is_technical INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0,
      default_collapsed INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#888', sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL,
      comment TEXT NOT NULL DEFAULT '', tag_id INTEGER, status_id INTEGER NOT NULL,
      start_date TEXT, deadline TEXT, finish_date TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      sort_order INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  await runMigrations(webMigrationApi(d));
  liveDb!.run(`DELETE FROM sync_outbox`);
  return d;
}

const boundUserId = (): string | null => {
  const res = liveDb!.exec(`SELECT value FROM settings WHERE key = 'bound_user_id'`);
  if (!res.length || !res[0].values.length) return null;
  return res[0].values[0][0] as string;
};

beforeEach(async () => {
  liveDb = null;
  upsertCalls.length = 0;
  session = null;
  planIsPro = false;
  ensureSeededIfEmpty.mockClear();
  ensureWelcomeTaskIfNeeded.mockClear();
  reconcilePersonalWorkspace.mockClear();
  await setupDb();
  const { _resetForTests } = await import('./index');
  _resetForTests();
});

describe('sync orchestrator — split paywall гейта (Fix 1)', () => {
  it('free: локальный bootstrap выполнен, сеть НЕ тронута, state=paywalled', async () => {
    const { syncNow, getSyncState } = await import('./index');
    session = { user: { id: 'user-free', email: 'f@e.c' } };

    const result = await syncNow();

    // Гейт закрыл сеть: state=paywalled, без сетевой ошибки.
    expect(getSyncState().status).toBe('paywalled');
    expect(result.error).toBeNull();

    // Локальный bootstrap состоялся — на ЛЮБОМ плане.
    expect(reconcilePersonalWorkspace).toHaveBeenCalledWith('user-free');
    expect(ensureSeededIfEmpty).toHaveBeenCalledTimes(1);
    expect(ensureWelcomeTaskIfNeeded).toHaveBeenCalledWith('user-free');

    // База локально привязана к аккаунту (Fix 2 опирается на это).
    expect(boundUserId()).toBe('user-free');

    // Сети нет: ни регистрации устройства, ни push.
    expect(upsertCalls.length).toBe(0);
  });

  it('pro: тот же путь доходит до полного sync (сеть открыта), state=synced', async () => {
    planIsPro = true;
    const { syncNow, getSyncState } = await import('./index');
    session = { user: { id: 'user-pro', email: 'p@e.c' } };

    const result = await syncNow();

    expect(result.ok).toBe(true);
    expect(getSyncState().status).toBe('synced');
    // reconcile всё так же выполнен до гейта.
    expect(reconcilePersonalWorkspace).toHaveBeenCalledWith('user-pro');
    // Сеть работает: устройство зарегистрировано.
    expect(upsertCalls.some(c => c.table === 'sync_devices')).toBe(true);
  });
});
