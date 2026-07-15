/**
 * Unit-тесты push worker (v0.9.35-dev.4).
 *
 * Подмена:
 *   - ../db на реальную sql.js in-memory базу (полная схема через миграции v1..v7)
 *   - ../supabase — мок с настраиваемым behavior'ом upsert
 *
 * Проверяем:
 *   1. Happy path: pushBatch отправляет payload'ы и удаляет строки из outbox.
 *   2. Error path: supabase возвращает error → attempt_count++, last_error записан.
 *   3. Retry / backoff: строка с attempt_count=1 и свежим last_attempt_at
 *      пропускается (не входит в батч).
 *   4. MAX_ATTEMPTS: строка с attempt_count>=5 пропускается навсегда.
 *   5. PUSH_ORDER: statuses пушатся раньше tasks.
 *   6. Soft-delete (op='delete'): отправляется через upsert (deleted_at уже в payload'е).
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

// Мок db.ts на sql.js.
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
    const changes = liveDb.getRowsModified();
    return { changes, lastInsertRowid: 0 };
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

// Мок supabase-js с настраиваемым upsert.
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
                order: () => ({
                  limit: async () => ({ data: [], error: null }),
                }),
              }),
            }),
          };
        },
      };
    },
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'test-user' } } }, error: null }),
    },
  },
  isSupabaseReachable: async () => true,
}));

// Мок logger чтобы не шуметь в консоли.
vi.mock('../logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

async function setupDb(): Promise<Database> {
  const SQL = await initSqlJs({ wasmBinary: WASM_BYTES });
  const d = new SQL.Database();
  liveDb = d;
  // Полная baseline v1 схема (совместимая с db.ts).
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
  // Очищаем seed'ы, чтобы каждый тест стартовал с пустым outbox.
  // Миграция v2 seed'ит default task_template, v7 бэкфиллит её в outbox.
  liveDb!.run(`DELETE FROM sync_outbox`);
});

/** Хелпер: вставляет статус с uuid и возвращает {id, uuid}. */
function insertStatus(name = 'Test', deleted_at: string | null = null): { id: number; uuid: string } {
  const uuid = `st-${Math.random().toString(36).slice(2, 10)}`;
  liveDb!.run(
    `INSERT INTO statuses (name, color, sort_order, behavior, uuid, version, client_id, deleted_at)
     VALUES (?, '#111', 0, 'middle', ?, 1, 'test-client', ?)`,
    [name, uuid, deleted_at],
  );
  const id = liveDb!.exec(`SELECT id FROM statuses WHERE uuid=?`, [uuid])[0].values[0][0] as number;
  return { id, uuid };
}

/** Хелпер: вставляет задачу с uuid. */
function insertTask(title: string, statusId: number): { id: number; uuid: string } {
  const uuid = `tk-${Math.random().toString(36).slice(2, 10)}`;
  const now = new Date().toISOString();
  liveDb!.run(
    `INSERT INTO tasks (title, status_id, created_at, updated_at, uuid, version, client_id)
     VALUES (?, ?, ?, ?, ?, 1, 'test-client')`,
    [title, statusId, now, now, uuid],
  );
  const id = liveDb!.exec(`SELECT id FROM tasks WHERE uuid=?`, [uuid])[0].values[0][0] as number;
  return { id, uuid };
}

describe('push worker', () => {
  it('happy path: успешный upsert очищает outbox', async () => {
    const { pushBatch } = await import('./push');
    const { uuid } = insertStatus('Test');
    liveDb!.run(
      `INSERT INTO sync_outbox (entity_table, entity_uuid, op, queued_at, attempt_count) VALUES ('statuses', ?, 'upsert', datetime('now'), 0)`,
      [uuid],
    );

    const result = await pushBatch('test-user', 'test-client');
    expect(result.pushed).toBe(1);
    expect(result.failed).toBe(0);
    expect(upsertCalls.length).toBe(1);
    expect(upsertCalls[0].table).toBe('sync_statuses');
    expect(upsertCalls[0].rows[0].id).toBe(uuid);
    expect(upsertCalls[0].rows[0].user_id).toBe('test-user');
    expect(upsertCalls[0].rows[0].client_id).toBe('test-client');

    // Outbox теперь пуст.
    const remain = liveDb!.exec(`SELECT COUNT(*) FROM sync_outbox`)[0].values[0][0];
    expect(remain).toBe(0);
  });

  it('error: увеличивает attempt_count, оставляет запись в outbox', async () => {
    const { pushBatch } = await import('./push');
    upsertHandler = async () => ({ error: { message: 'network down' } });
    const { uuid } = insertStatus('Test');
    liveDb!.run(
      `INSERT INTO sync_outbox (entity_table, entity_uuid, op, queued_at, attempt_count) VALUES ('statuses', ?, 'upsert', datetime('now'), 0)`,
      [uuid],
    );

    const result = await pushBatch('u', 'c');
    expect(result.failed).toBe(1);
    expect(result.pushed).toBe(0);
    expect(result.firstError).toContain('network');

    const outbox = liveDb!.exec(
      `SELECT attempt_count, last_error FROM sync_outbox WHERE entity_uuid=?`,
      [uuid],
    )[0].values[0];
    expect(outbox[0]).toBe(1);
    expect(String(outbox[1])).toContain('network');
  });

  it('backoff: недавняя неудачная попытка не входит в батч', async () => {
    const { pushBatch, _internals } = await import('./push');
    // isReadyForRetry: attempt_count=1 требует 1с паузы. Проверяем что 100мс мало.
    const nowIso = new Date().toISOString();
    expect(_internals.isReadyForRetry(1, nowIso)).toBe(false);
    // А с 5с — уже готово.
    const oldIso = new Date(Date.now() - 5000).toISOString();
    expect(_internals.isReadyForRetry(1, oldIso)).toBe(true);

    // Строка с attempt_count=1 и свежим last_attempt_at не входит в результат.
    const { uuid } = insertStatus('T');
    liveDb!.run(
      `INSERT INTO sync_outbox (entity_table, entity_uuid, op, queued_at, attempt_count, last_attempt_at) VALUES ('statuses', ?, 'upsert', datetime('now'), 1, datetime('now'))`,
      [uuid],
    );

    const result = await pushBatch('u', 'c');
    expect(result.pushed).toBe(0);
    expect(result.failed).toBe(0);
    expect(upsertCalls.length).toBe(0);
  });

  it('MAX_ATTEMPTS: attempt_count>=5 пропускается навсегда', async () => {
    const { pushBatch, MAX_ATTEMPTS, _internals } = await import('./push');
    expect(MAX_ATTEMPTS).toBe(5);
    // Даже старый last_attempt_at — не поможет.
    const oldIso = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    expect(_internals.isReadyForRetry(5, oldIso)).toBe(false);
    expect(_internals.isReadyForRetry(10, oldIso)).toBe(false);

    const { uuid } = insertStatus('T');
    liveDb!.run(
      `INSERT INTO sync_outbox (entity_table, entity_uuid, op, queued_at, attempt_count, last_attempt_at) VALUES ('statuses', ?, 'upsert', datetime('now'), 5, ?)`,
      [uuid, oldIso],
    );

    const result = await pushBatch('u', 'c');
    expect(result.pushed).toBe(0);
    expect(upsertCalls.length).toBe(0);
    // Запись всё ещё в outbox.
    const remain = liveDb!.exec(`SELECT COUNT(*) FROM sync_outbox`)[0].values[0][0];
    expect(remain).toBe(1);
  });

  it('PUSH_ORDER: statuses пушатся раньше tasks', async () => {
    const { pushBatch } = await import('./push');
    const st = insertStatus('S');
    const task = insertTask('t1', st.id);
    const stUuid = st.uuid;
    const taskUuid = task.uuid;

    // Enqueue: задача первой, статус вторым — но push должен послать статус первым.
    liveDb!.run(
      `INSERT INTO sync_outbox (entity_table, entity_uuid, op, queued_at, attempt_count) VALUES ('tasks', ?, 'upsert', datetime('now'), 0)`,
      [taskUuid],
    );
    liveDb!.run(
      `INSERT INTO sync_outbox (entity_table, entity_uuid, op, queued_at, attempt_count) VALUES ('statuses', ?, 'upsert', datetime('now'), 0)`,
      [stUuid],
    );

    await pushBatch('u', 'c');
    // Первый upsert должен быть sync_statuses.
    expect(upsertCalls[0].table).toBe('sync_statuses');
    expect(upsertCalls[1].table).toBe('sync_tasks');
  });

  it('Fix 4: одна «отравляющая» строка не валит валидные (построчный ретрай)', async () => {
    const { pushBatch } = await import('./push');
    const good1 = insertStatus('G1');
    const bad = insertStatus('BAD');
    const good2 = insertStatus('G2');
    for (const s of [good1, bad, good2]) {
      liveDb!.run(
        `INSERT INTO sync_outbox (entity_table, entity_uuid, op, queued_at, attempt_count) VALUES ('statuses', ?, 'upsert', datetime('now'), 0)`,
        [s.uuid],
      );
    }
    // Батч (все 3) содержит плохую строку → сервер откатывает весь запрос.
    // На построчном ретрае плохая падает (permanent 23502), валидные проходят.
    upsertHandler = async (_table, rows) => {
      if (rows.some((r: any) => r.id === bad.uuid)) {
        return { error: { message: 'null value in column "x" violates not-null (23502)' } };
      }
      return { error: null };
    };

    const result = await pushBatch('u', 'c');
    expect(result.pushed).toBe(2);
    expect(result.failed).toBe(1);
    // 1 батч-запрос (упал) + 3 построчных = 4 обращения к upsert.
    expect(upsertCalls.length).toBe(4);
    // Валидные удалены из outbox, осталась только плохая.
    const remain = liveDb!.exec(`SELECT entity_uuid FROM sync_outbox`)[0];
    expect(remain.values.length).toBe(1);
    expect(remain.values[0][0]).toBe(bad.uuid);
    // Плохая помечена permanent (attempt_count=MAX) — больше не блокирует батчи.
    const ac = liveDb!.exec(`SELECT attempt_count FROM sync_outbox WHERE entity_uuid=?`, [bad.uuid])[0].values[0][0];
    expect(ac).toBe(5);
  });

  it('Fix 4: батч из ОДНОЙ строки при ошибке не ретраит повторно (единичный markFailure)', async () => {
    const { pushBatch } = await import('./push');
    const { uuid } = insertStatus('S1');
    liveDb!.run(
      `INSERT INTO sync_outbox (entity_table, entity_uuid, op, queued_at, attempt_count) VALUES ('statuses', ?, 'upsert', datetime('now'), 0)`,
      [uuid],
    );
    upsertHandler = async () => ({ error: { message: 'network down' } });

    const result = await pushBatch('u', 'c');
    expect(result.failed).toBe(1);
    // Ровно один upsert (батч=1 не уходит в построчный цикл).
    expect(upsertCalls.length).toBe(1);
    const ac = liveDb!.exec(`SELECT attempt_count FROM sync_outbox WHERE entity_uuid=?`, [uuid])[0].values[0][0];
    expect(ac).toBe(1);
  });

  it('Fix 4: валидный батч (>1) уходит одним запросом, без построчного', async () => {
    const { pushBatch } = await import('./push');
    const s1 = insertStatus('A');
    const s2 = insertStatus('B');
    for (const s of [s1, s2]) {
      liveDb!.run(
        `INSERT INTO sync_outbox (entity_table, entity_uuid, op, queued_at, attempt_count) VALUES ('statuses', ?, 'upsert', datetime('now'), 0)`,
        [s.uuid],
      );
    }
    const result = await pushBatch('u', 'c');
    expect(result.pushed).toBe(2);
    // Ровно один батч-запрос (без построчного ретрая на успехе).
    expect(upsertCalls.length).toBe(1);
    expect(upsertCalls[0].rows.length).toBe(2);
  });

  it('soft-delete (op=delete): payload содержит deleted_at и уходит через upsert', async () => {
    const { pushBatch } = await import('./push');
    const { uuid } = insertStatus('X', new Date().toISOString());
    liveDb!.run(
      `INSERT INTO sync_outbox (entity_table, entity_uuid, op, queued_at, attempt_count) VALUES ('statuses', ?, 'delete', datetime('now'), 0)`,
      [uuid],
    );

    const result = await pushBatch('u', 'c');
    expect(result.pushed).toBe(1);
    expect(upsertCalls.length).toBe(1);
    expect(upsertCalls[0].table).toBe('sync_statuses');
    expect(upsertCalls[0].rows[0].deleted_at).toBeTruthy();
  });
});

describe('isPermanentError (Bug A — регресс-якоря)', () => {
  it('42501 (RLS) — permanent', async () => {
    const { _internals } = await import('./push');
    expect(_internals.isPermanentError('new row violates row-level security policy (42501)')).toBe(true);
    expect(_internals.isPermanentError('permission denied 42501')).toBe(true);
  });

  it('23502 (not-null) и 23514 (check) — permanent', async () => {
    const { _internals } = await import('./push');
    expect(_internals.isPermanentError('null value in column "owner_id" (23502)')).toBe(true);
    expect(_internals.isPermanentError('violates check constraint (23514)')).toBe(true);
  });

  it('23503 (FK) — НЕ permanent (транзиентно, ретраится)', async () => {
    const { _internals } = await import('./push');
    expect(_internals.isPermanentError('violates foreign key constraint (23503)')).toBe(false);
    expect(_internals.isForeignKeyViolation('violates foreign key constraint (23503)')).toBe(true);
  });

  it('сетевые/5xx — НЕ permanent', async () => {
    const { _internals } = await import('./push');
    expect(_internals.isPermanentError('network down')).toBe(false);
    expect(_internals.isPermanentError('503 service unavailable')).toBe(false);
  });
});

describe('workspaceToCloudPayload / memberToCloudPayload — живой owner (Bug A)', () => {
  it('owner_id/user_id ws берутся из живой сессии, а не из протухшего локального owner_id', async () => {
    const { workspaceToCloudPayload } = await import('./mappers');
    const row: any = {
      uuid: 'ws_s1', name: 'Shared', kind: 'shared',
      owner_id: 'STALE-FOREIGN-UID', // рассинхрон bound_user_id
      version: 1, client_id: 'c', updated_at: new Date().toISOString(), deleted_at: null,
    };
    const payload = workspaceToCloudPayload(row, 'LIVE-UID', 'client-1');
    expect(payload.owner_id).toBe('LIVE-UID');
    expect(payload.user_id).toBe('LIVE-UID');
  });

  it('owner-membership: user_id берётся из живой сессии', async () => {
    const { memberToCloudPayload } = await import('./mappers');
    const row: any = {
      uuid: 'wsm_1', workspace_id: 'ws_s1', role: 'owner',
      user_id: 'STALE-FOREIGN-UID', invited_by: null, joined_at: null,
      version: 1, client_id: 'c', updated_at: new Date().toISOString(), deleted_at: null,
    };
    const payload = memberToCloudPayload(row, 'LIVE-UID', 'client-1');
    expect(payload.user_id).toBe('LIVE-UID');
  });

  it('НЕ-owner membership: чужой user_id сохраняется (invite/remove участника)', async () => {
    const { memberToCloudPayload } = await import('./mappers');
    const row: any = {
      uuid: 'wsm_2', workspace_id: 'ws_s1', role: 'editor',
      user_id: 'OTHER-MEMBER-UID', invited_by: 'LIVE-UID', joined_at: null,
      version: 1, client_id: 'c', updated_at: new Date().toISOString(), deleted_at: null,
    };
    const payload = memberToCloudPayload(row, 'LIVE-UID', 'client-1');
    expect(payload.user_id).toBe('OTHER-MEMBER-UID');
  });
});
