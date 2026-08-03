/**
 * Unit-тесты v0.9.35-dev.5 фич:
 *   1. overdue push: append-only, id-uuid, требует task uuid.
 *   2. Retry policy: permanent errors (401/403/404/422/RLS/PGRST) не ретраятся.
 *   3. Realtime: debounced schedulePull.
 *
 * Инфраструктура (sql.js + моки supabase/logger) — по образцу push.test.ts.
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

// Мок supabase — только upsert и минимально необходимая цепочка select.
type UpsertHandler = (
  table: string,
  rows: any[],
  opts: any,
) => Promise<{ error: { message: string } | null }>;

let upsertHandler: UpsertHandler = async () => ({ error: null });
const upsertCalls: { table: string; rows: any[]; opts: any }[] = [];

vi.mock('../supabase', () => ({
  supabase: {
    from(table: string) {
      return {
        upsert(rows: any[], opts: any) {
          upsertCalls.push({ table, rows, opts });
          return upsertHandler(table, rows, opts);
        },
        select() {
          return {
            eq: () => ({
              gt: () => ({
                order: () => ({ limit: async () => ({ data: [], error: null }) }),
              }),
            }),
          };
        },
      };
    },
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'test-user' } } }, error: null }),
    },
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    })),
    removeChannel: vi.fn(async () => {}),
  },
  isSupabaseReachable: async () => true,
}));

vi.mock('../logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
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
  return d;
}

beforeEach(async () => {
  liveDb = null;
  upsertCalls.length = 0;
  upsertHandler = async () => ({ error: null });
  await setupDb();
  liveDb!.run(`DELETE FROM sync_outbox`);
});

function insertStatus(name = 'Test'): { id: number; uuid: string } {
  const uuid = `st-${Math.random().toString(36).slice(2, 10)}`;
  liveDb!.run(
    `INSERT INTO statuses (name, color, sort_order, behavior, uuid, version, client_id)
     VALUES (?, '#111', 0, 'middle', ?, 1, 'test-client')`,
    [name, uuid],
  );
  const id = liveDb!.exec(`SELECT id FROM statuses WHERE uuid=?`, [uuid])[0].values[0][0] as number;
  return { id, uuid };
}

function insertTask(title: string, statusId: number, deadline = '2026-01-01'): { id: number; uuid: string } {
  const uuid = `tk-${Math.random().toString(36).slice(2, 10)}`;
  const now = new Date().toISOString();
  liveDb!.run(
    `INSERT INTO tasks (title, status_id, deadline, created_at, updated_at, uuid, version, client_id)
     VALUES (?, ?, ?, ?, ?, ?, 1, 'test-client')`,
    [title, statusId, deadline, now, now, uuid],
  );
  const id = liveDb!.exec(`SELECT id FROM tasks WHERE uuid=?`, [uuid])[0].values[0][0] as number;
  return { id, uuid };
}

function insertOverdueEvent(taskId: number, deadline: string, eventDate: string): { id: number; uuid: string } {
  const uuid = `ov-${Math.random().toString(36).slice(2, 10)}`;
  const now = new Date().toISOString();
  liveDb!.run(
    `INSERT INTO overdue_events (task_id, deadline_snapshot, event_date, created_at, updated_at, uuid, version, client_id)
     VALUES (?, ?, ?, ?, ?, ?, 1, 'test-client')`,
    [taskId, deadline, eventDate, now, now, uuid],
  );
  const id = liveDb!.exec(`SELECT id FROM overdue_events WHERE uuid=?`, [uuid])[0].values[0][0] as number;
  return { id, uuid };
}

// ─── 1. Overdue push ─────────────────────────────────────────────────────────

describe('overdue_events push (v0.9.35-dev.5)', () => {
  it('resolveTaskUuid возвращает uuid задачи', async () => {
    const { resolveTaskUuid } = await import('./mappers');
    const st = insertStatus('S');
    const task = insertTask('t', st.id);
    expect(resolveTaskUuid(task.id)).toBe(task.uuid);
  });

  it('resolveTaskUuid бросает если task не имеет uuid', async () => {
    const { resolveTaskUuid } = await import('./mappers');
    // Задача, которой нет.
    expect(() => resolveTaskUuid(999999)).toThrow(/has no uuid|no uuid/);
  });

  it('overdueEventToCloudPayload формирует правильный payload с task uuid', async () => {
    const { overdueEventToCloudPayload } = await import('./mappers');
    const st = insertStatus('S');
    const task = insertTask('t1', st.id, '2026-06-15');
    const ev = insertOverdueEvent(task.id, '2026-06-15', '2026-06-16');
    // Читаем локальную строку.
    const row = liveDb!.exec(`SELECT * FROM overdue_events WHERE id=?`, [ev.id])[0];
    const cols = row.columns;
    const vals = row.values[0];
    const localRow: any = Object.fromEntries(cols.map((c, i) => [c, vals[i]]));
    const payload = overdueEventToCloudPayload(localRow, 'user-1', 'client-1');
    expect(payload.id).toBe(ev.uuid);
    expect(payload.task_id).toBe(task.uuid);          // uuid, не int
    expect(payload.user_id).toBe('user-1');
    expect(payload.deadline_snapshot).toBe('2026-06-15');
    expect(payload.event_date).toBe('2026-06-16');
    // F13/Fix C: маппер ВСЕГДА ставит ТЕКУЩИЙ (зарегистрированный) client_id,
    // а НЕ протухший row.client_id стороннего устройства — иначе FK sync_*.client_id → sync_devices(id) (23503).
    expect(payload.client_id).toBe('client-1');       // текущее устройство, не row.client_id
  });

  it('push overdue: append-only, идёт через upsert в sync_overdue_events', async () => {
    const { pushBatch } = await import('./push');
    const st = insertStatus('S');
    const task = insertTask('t', st.id);
    const ev = insertOverdueEvent(task.id, '2026-01-01', '2026-01-02');
    // Порядок enqueue не важен — PUSH_ORDER рулит.
    liveDb!.run(
      `INSERT INTO sync_outbox (entity_table, entity_uuid, op, queued_at, attempt_count) VALUES ('statuses', ?, 'upsert', datetime('now'), 0)`,
      [st.uuid],
    );
    liveDb!.run(
      `INSERT INTO sync_outbox (entity_table, entity_uuid, op, queued_at, attempt_count) VALUES ('overdue_events', ?, 'upsert', datetime('now'), 0)`,
      [ev.uuid],
    );
    liveDb!.run(
      `INSERT INTO sync_outbox (entity_table, entity_uuid, op, queued_at, attempt_count) VALUES ('tasks', ?, 'upsert', datetime('now'), 0)`,
      [task.uuid],
    );

    const result = await pushBatch('user-1', 'client-1');
    expect(result.failed).toBe(0);
    // PUSH_ORDER: statuses → tags → tasks → templates → overdue_events.
    const tables = upsertCalls.map(c => c.table);
    expect(tables.indexOf('sync_statuses')).toBeLessThan(tables.indexOf('sync_tasks'));
    expect(tables.indexOf('sync_tasks')).toBeLessThan(tables.indexOf('sync_overdue_events'));
    // Payload содержит task uuid.
    const overdueCall = upsertCalls.find(c => c.table === 'sync_overdue_events')!;
    expect(overdueCall.rows[0].task_id).toBe(task.uuid);
    // outbox очищен.
    const remain = liveDb!.exec(`SELECT COUNT(*) FROM sync_outbox`)[0].values[0][0];
    expect(remain).toBe(0);
  });
});

// ─── 2. Retry policy: permanent errors ───────────────────────────────────────

describe('isPermanentError (v0.9.35-dev.5)', () => {
  it('HTTP 4xx (401/403/404/422) — permanent', async () => {
    const { _internals } = await import('./push');
    const { isPermanentError } = _internals;
    expect(isPermanentError('HTTP 401 Unauthorized')).toBe(true);
    expect(isPermanentError('403 Forbidden')).toBe(true);
    expect(isPermanentError('Not found (404)')).toBe(true);
    expect(isPermanentError('422 Unprocessable Entity')).toBe(true);
  });

  it('409 и 429 — НЕ permanent (транзиентные)', async () => {
    const { _internals } = await import('./push');
    const { isPermanentError } = _internals;
    expect(isPermanentError('409 Conflict')).toBe(false);
    expect(isPermanentError('429 Too Many Requests')).toBe(false);
    expect(isPermanentError('500 Internal Server Error')).toBe(false);
    expect(isPermanentError('network down')).toBe(false);
  });

  it('RLS / does not exist / invalid input — permanent', async () => {
    const { _internals } = await import('./push');
    const { isPermanentError } = _internals;
    expect(isPermanentError('new row violates row-level security policy')).toBe(true);
    expect(isPermanentError('relation "sync_foo" does not exist')).toBe(true);
    expect(isPermanentError('invalid input syntax for type uuid: "xyz"')).toBe(true);
    expect(isPermanentError('JWT expired')).toBe(true);
  });

  it('PostgREST error codes (PGRSTNNN) — permanent', async () => {
    const { _internals } = await import('./push');
    const { isPermanentError } = _internals;
    expect(isPermanentError('PGRST116 requested row not found')).toBe(true);
    expect(isPermanentError('code=PGRST301: ...')).toBe(true);
  });

  it('permanent error: attempt_count сразу выставляется в MAX_ATTEMPTS', async () => {
    const { pushBatch, MAX_ATTEMPTS } = await import('./push');
    upsertHandler = async () => ({ error: { message: 'new row violates row-level security policy' } });
    const { uuid } = insertStatus('T');
    liveDb!.run(
      `INSERT INTO sync_outbox (entity_table, entity_uuid, op, queued_at, attempt_count) VALUES ('statuses', ?, 'upsert', datetime('now'), 0)`,
      [uuid],
    );

    const result = await pushBatch('u', 'c');
    expect(result.failed).toBe(1);
    const row = liveDb!.exec(
      `SELECT attempt_count, last_error FROM sync_outbox WHERE entity_uuid=?`,
      [uuid],
    )[0].values[0];
    expect(row[0]).toBe(MAX_ATTEMPTS);          // сразу помечен как исчерпавший попытки
    expect(String(row[1])).toContain('[permanent]');
  });

  it('транзиентная ошибка: attempt_count = 1 (обычный инкремент)', async () => {
    const { pushBatch } = await import('./push');
    upsertHandler = async () => ({ error: { message: '500 Internal Server Error' } });
    const { uuid } = insertStatus('T');
    liveDb!.run(
      `INSERT INTO sync_outbox (entity_table, entity_uuid, op, queued_at, attempt_count) VALUES ('statuses', ?, 'upsert', datetime('now'), 0)`,
      [uuid],
    );

    await pushBatch('u', 'c');
    const row = liveDb!.exec(
      `SELECT attempt_count, last_error FROM sync_outbox WHERE entity_uuid=?`,
      [uuid],
    )[0].values[0];
    expect(row[0]).toBe(1);
    expect(String(row[1])).not.toContain('[permanent]');
  });

  // ─── FK violation (23503) — child раньше parent'а, ретраим (PR-b-01) ─────────
  it('23503 (FK violation) — НЕ permanent (транзиентная, ретраим)', async () => {
    const { _internals } = await import('./push');
    const { isPermanentError } = _internals;
    expect(isPermanentError('code=23503 insert or update on table violates foreign key constraint')).toBe(false);
    expect(isPermanentError('violates foreign key constraint "sync_tasks_workspace_id_fkey"')).toBe(false);
  });

  it('isForeignKeyViolation распознаёт 23503 и текст FK-констрейнта', async () => {
    const { _internals } = await import('./push');
    const { isForeignKeyViolation } = _internals;
    expect(isForeignKeyViolation('SQLSTATE 23503')).toBe(true);
    expect(isForeignKeyViolation('violates foreign key constraint "sync_tasks_workspace_id_fkey"')).toBe(true);
    expect(isForeignKeyViolation('500 Internal Server Error')).toBe(false);
    expect(isForeignKeyViolation('new row violates row-level security policy')).toBe(false);
  });

  it('FK violation: child ретраится (attempt_count=1), НЕ помечается permanent', async () => {
    const { pushBatch, MAX_ATTEMPTS } = await import('./push');
    // Симулируем: task пушится раньше своего workspace → сервер шлёт 23503.
    upsertHandler = async () => ({
      error: {
        message:
          'insert or update on table "sync_tasks" violates foreign key constraint "sync_tasks_workspace_id_fkey" (23503)',
      },
    });
    const { uuid } = insertStatus('T');
    liveDb!.run(
      `INSERT INTO sync_outbox (entity_table, entity_uuid, op, queued_at, attempt_count) VALUES ('statuses', ?, 'upsert', datetime('now'), 0)`,
      [uuid],
    );

    const result = await pushBatch('u', 'c');
    expect(result.failed).toBe(1);
    const row = liveDb!.exec(
      `SELECT attempt_count, last_error FROM sync_outbox WHERE entity_uuid=?`,
      [uuid],
    )[0].values[0];
    // Ретрай, а не исчерпание попыток: attempt_count=1 (< MAX), без [permanent].
    expect(row[0]).toBe(1);
    expect(row[0]).not.toBe(MAX_ATTEMPTS);
    expect(String(row[1])).not.toContain('[permanent]');
  });
});

// ─── 3. Realtime debounce ────────────────────────────────────────────────────

describe('realtime schedulePull (v0.9.35-dev.5)', () => {
  it('WATCHED_TABLES содержит все sync-таблицы', async () => {
    const { _internals } = await import('./realtime');
    expect(_internals.WATCHED_TABLES).toEqual([
      'sync_workspaces',
      'sync_workspace_members',
      'sync_workspace_settings',
      'sync_tasks',
      'sync_statuses',
      'sync_tags',
      'sync_task_templates',
      'sync_overdue_events',
      'sync_task_hold_periods',
      'sync_task_activity_log',
    ]);
  });

  it('debounce: серия schedulePull запускает pullAll ровно 1 раз', async () => {
    vi.useFakeTimers();
    // Мокаем pullAll до импорта realtime.
    vi.doMock('./pull', () => ({
      pullAll: vi.fn(async () => ({ applied: 0, skipped: 0, deferred: 0, firstError: null })),
    }));
    // Свежий импорт с мокнутым pull.
    vi.resetModules();
    const { _internals } = await import('./realtime');
    const pullMod = await import('./pull');
    const pullSpy = pullMod.pullAll as unknown as ReturnType<typeof vi.fn>;

    // 5 подряд событий в течение debounce окна.
    _internals.schedulePull('user-1');
    _internals.schedulePull('user-1');
    _internals.schedulePull('user-1');
    _internals.schedulePull('user-1');
    _internals.schedulePull('user-1');

    // Ещё не сработало (600мс debounce).
    expect(pullSpy).not.toHaveBeenCalled();
    // Прошло 500мс — всё ещё не сработало.
    await vi.advanceTimersByTimeAsync(500);
    expect(pullSpy).not.toHaveBeenCalled();
    // Прошло больше debounce.
    await vi.advanceTimersByTimeAsync(200);
    expect(pullSpy).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
    vi.doUnmock('./pull');
    vi.resetModules();
  });
});
