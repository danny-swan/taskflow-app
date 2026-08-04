// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
/**
 * F48-тест: pullAll должен прекращать сетевые запросы, если сессия перестала
 * принадлежать userId ПОСРЕДИ цикла (signOut()/смена аккаунта на этом же
 * устройстве во время долгого pullAll, у которого несколько пространств).
 *
 * Корень бага (подтверждён на реальном логе продакшена): syncNow() проверяет
 * сессию ОДИН раз в самом начале (шаг 1 getSession()), а дальше pullAll идёт
 * по ВСЕМ пространствам пользователя (у реального аккаунта их было 8-14),
 * дёргая по 9 таблиц на каждое. Если signOut() (выход/смена аккаунта) выполняется
 * ПОСРЕДИ этого цикла — все оставшиеся сетевые запросы летят без валидного
 * токена и получают "permission denied for table sync_X" (42501, anon-роль без
 * грантов — НЕ RLS-конфликт из Bug 3/F47) на КАЖДУЮ таблицу КАЖДОГО оставшегося
 * пространства. В реальном логе это дало 127 предупреждений за один цикл.
 *
 * Фикс: перед стартом pullAll и перед КАЖДЫМ пространством фазы 2 pullAll
 * дёшево перепроверяет (supabase.auth.getSession(), без сети — читает
 * локальный кэш) что сессия ещё принадлежит этому userId; если нет — сразу
 * прерывает цикл, не трогая оставшиеся пространства/таблицы.
 *
 * До фикса оба теста ниже КРАСНЫЕ (pullAll продолжает бить сеть после смены
 * сессии). После фикса — зелёные.
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

const ME = '11111111-2222-3333-4444-555555555555';
const OTHER = '99999999-8888-7777-6666-555555555555';
const PERSONAL = 'ws_' + ME.toLowerCase().replace(/-/g, '');
const SHARED = 'ws_sharedteam0000000000000000000';
const T = '2026-07-10T12:00:00Z';

// H.session — управляемая «текущая сессия» supabase.auth.getSession().
// H.fromCalls — счётчик реальных сетевых запросов (по имени облачной таблицы),
// чтобы доказать, что pullAll ПРЕКРАТИЛ их делать после смены сессии, а не
// просто перестал что-то применять.
const H = vi.hoisted(() => ({
  store: {} as Record<string, any[]>,
  session: { userId: null as string | null },
  fromCalls: [] as string[],
}));

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
    H.fromCalls.push(table);
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
    supabase: {
      from: (t: string) => makeQuery(t),
      auth: {
        getSession: async () => ({
          data: { session: H.session.userId ? { user: { id: H.session.userId } } : null },
          error: null,
        }),
      },
    },
    isSupabaseReachable: async () => true,
  };
});

vi.mock('../logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../sync', () => ({ scheduleAutoSync: vi.fn() }));

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
  // Членство ME в SHARED — после фазы 1 у пользователя будет ДВА пространства
  // (PERSONAL + SHARED), т.е. фаза 2 обязана сделать минимум 2 прохода по 9
  // таблицам. Данных внутри специально нет — тест проверяет сам факт СЕТЕВЫХ
  // вызовов (H.fromCalls), а не применённые строки.
  H.store = {
    sync_workspace_members: [
      {
        id: 'wsm-shared', workspace_id: SHARED, user_id: ME, role: 'editor',
        invited_by: OTHER, joined_at: T,
        created_at: T, updated_at: T, deleted_at: null, version: 1, client_id: 'c',
      },
    ],
    sync_workspaces: [],
    sync_statuses: [],
    sync_tasks: [],
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
  H.fromCalls = [];
  H.session.userId = ME;
  await setupDb();
  seedCloud();
});

describe('F48: pullAll прерывается, если сессия сменилась ДО старта', () => {
  it('сессия уже другого пользователя перед вызовом → ноль сетевых запросов', async () => {
    H.session.userId = OTHER; // сессия сменилась ДО того, как syncNow успел вызвать pullAll
    const { pullAll } = await import('./pull');
    const result = await pullAll(ME);

    expect(H.fromCalls.length).toBe(0);
    expect(result).toEqual({ applied: 0, skipped: 0, deferred: 0, firstError: null });
  });

  it('сессия разлогинена (null) перед вызовом → ноль сетевых запросов', async () => {
    H.session.userId = null;
    const { pullAll } = await import('./pull');
    await pullAll(ME);

    expect(H.fromCalls.length).toBe(0);
  });
});

describe('F48: pullAll прерывается, если сессия сменилась ПОСРЕДИ цикла (фаза 2)', () => {
  it('signOut() между пространствами → фаза 2 не трогает оставшиеся пространства', async () => {
    const { pullAll } = await import('./pull');

    // Считаем сетевые вызовы фазы 2 (по имени пространства нет тега, поэтому
    // считаем ЛЮБОЙ вызов sync_statuses — первая таблица phase2 в PULL_ORDER —
    // как «начало нового пространства», и после первого такого вызова имитируем
    // signOut() ПОСРЕДИ обработки первого пространства.
    let firstWsStatusesSeen = false;
    const origPush = H.fromCalls.push.bind(H.fromCalls);
    H.fromCalls.push = ((table: string) => {
      if (table === 'sync_statuses' && !firstWsStatusesSeen) {
        firstWsStatusesSeen = true;
        // Имитация: пользователь нажал "Выйти"/сменил аккаунт ПОСРЕДИ pullAll,
        // но текущее пространство (первое) уже начало обрабатываться.
        H.session.userId = OTHER;
      }
      return origPush(table);
    }) as typeof H.fromCalls.push;

    await pullAll(ME);

    // Членство (фаза 1) — ровно 2 вызова, независимо от числа пространств
    // (проход A + проход B), это НЕ то, что мы чиним здесь.
    const memberCalls = H.fromCalls.filter(t => t === 'sync_workspace_members').length;
    expect(memberCalls).toBe(2);

    // КЛЮЧЕВОЕ: фаза 2 должна была сделать РОВНО 1 полный проход по 9 таблицам
    // одного пространства (то, что уже начало обрабатываться, когда сессия
    // сменилась), а НЕ 2 прохода (personal + shared) — второе пространство
    // не должно быть тронуто вообще.
    const phase2Calls = H.fromCalls.filter(t => t !== 'sync_workspace_members').length;
    expect(phase2Calls).toBe(9);
  });
});
