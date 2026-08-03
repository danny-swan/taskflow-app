/**
 * Тест миграции v14 (Wave A PR-hotfix) — сброс застрявших outbox-строк после
 * серверного фикса 0037.
 *
 * Контекст бага: upsert (INSERT ... ON CONFLICT ... RETURNING) новых workspace-
 * сущностей отклонялся RLS с 403/42501 (SELECT-политика для RETURNING требовала
 * membership, которого у нового пространства ещё нет). Клиентский isPermanentError
 * относит 403 и "row-level security" к ПОСТОЯННЫМ → markFailure выставлял таким
 * строкам attempt_count=MAX_ATTEMPTS и префикс last_error='[permanent] ...'.
 * Такие строки isReadyForRetry пропускает навсегда, поэтому даже после деплоя
 * 0037 ранее застрявшие пространства не отправлялись повторно.
 *
 * v14 одноразово сбрасывает attempt_count=0/last_attempt_at=NULL/last_error=NULL
 * ровно для строк, застрявших по этой причине (маркеры RLS/403/42501/permission
 * denied), и НЕ трогает прочие настоящие permanent-ошибки.
 */
import { describe, it, expect } from 'vitest';
import initSqlJs, { type Database } from 'sql.js';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runMigrations, webMigrationApi, MIGRATIONS, TARGET_VERSION } from './migrations';

const req = createRequire(import.meta.url);
const WASM_PATH = req.resolve('sql.js/dist/sql-wasm.wasm');
const _wasmBuf = readFileSync(WASM_PATH);
const WASM_BYTES = _wasmBuf.buffer.slice(
  _wasmBuf.byteOffset,
  _wasmBuf.byteOffset + _wasmBuf.byteLength,
) as ArrayBuffer;

/** Baseline v1 схема — минимум, миграции доведут до TARGET_VERSION (создадут sync_outbox). */
async function freshDb(): Promise<Database> {
  const SQL = await initSqlJs({ wasmBinary: WASM_BYTES });
  const d = new SQL.Database();
  d.run(`
    CREATE TABLE statuses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      behavior TEXT NOT NULL DEFAULT 'middle',
      sort_order INTEGER NOT NULL,
      is_seed INTEGER NOT NULL DEFAULT 0,
      is_technical INTEGER NOT NULL DEFAULT 0,
      hidden INTEGER NOT NULL DEFAULT 0,
      default_collapsed INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
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
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    PRAGMA user_version = 1;
  `);
  return d;
}

/** Вставляет outbox-строку с заданными attempt_count/last_error. */
function insertOutbox(
  d: Database,
  entityTable: string,
  entityUuid: string,
  attemptCount: number,
  lastError: string | null,
): void {
  d.run(
    `INSERT INTO sync_outbox
       (entity_table, entity_uuid, op, queued_at, attempt_count, last_attempt_at, last_error)
     VALUES (?, ?, 'upsert', datetime('now'), ?, datetime('now'), ?)`,
    [entityTable, entityUuid, attemptCount, lastError],
  );
}

/** Возвращает (attempt_count, last_error) строки по uuid. */
function row(d: Database, uuid: string): { attempt: number; err: string | null } {
  const r = d.exec(
    `SELECT attempt_count, last_error FROM sync_outbox WHERE entity_uuid = ?`,
    [uuid],
  )[0].values[0];
  return { attempt: r[0] as number, err: (r[1] as string | null) ?? null };
}

/** Прогоняет миграции, затем откатывает user_version на 13 и прогоняет заново (накат v14). */
async function reapplyV14(d: Database): Promise<void> {
  d.run(`PRAGMA user_version = 13`);
  await runMigrations(webMigrationApi(d));
}

describe('migration v14 (reset outbox rows stuck on RLS/403)', () => {
  it('сбрасывает застрявшие по RLS/403 строки (attempt_count=0, last_error=NULL)', async () => {
    const d = await freshDb();
    await runMigrations(webMigrationApi(d));

    // Застрявшие ИМЕННО из-за бага: разные варианты маркеров.
    insertOutbox(d, 'workspaces', 'ws-rls', 5, '[permanent] new row violates row-level security policy');
    insertOutbox(d, 'workspace_members', 'wsm-403', 5, '[permanent] 403 Forbidden');
    insertOutbox(d, 'statuses', 'st-42501', 5, '[permanent] 42501: permission denied');
    insertOutbox(d, 'tasks', 'tsk-permdenied', 5, '[permanent] permission denied for table sync_tasks');

    await reapplyV14(d);

    for (const uuid of ['ws-rls', 'wsm-403', 'st-42501', 'tsk-permdenied']) {
      const r = row(d, uuid);
      expect(r.attempt).toBe(0);
      expect(r.err).toBeNull();
    }
  });

  it('НЕ трогает настоящие permanent-ошибки (not-null / check / undefined column)', async () => {
    const d = await freshDb();
    await runMigrations(webMigrationApi(d));

    insertOutbox(d, 'tasks', 'tsk-notnull', 5, '[permanent] 23502: null value in column "title"');
    insertOutbox(d, 'tasks', 'tsk-check', 5, '[permanent] 23514: check constraint violated');
    insertOutbox(d, 'tasks', 'tsk-undefcol', 5, '[permanent] 42703: column "foo" does not exist');

    await reapplyV14(d);

    for (const uuid of ['tsk-notnull', 'tsk-check', 'tsk-undefcol']) {
      const r = row(d, uuid);
      expect(r.attempt).toBe(5); // остаётся исчерпанной
      expect(r.err).not.toBeNull();
    }
  });

  it('НЕ трогает строки, ещё не исчерпавшие попытки (attempt_count < 5)', async () => {
    const d = await freshDb();
    await runMigrations(webMigrationApi(d));

    // Транзиентная ошибка на 2-й попытке — не наш случай, не сбрасываем.
    insertOutbox(d, 'workspaces', 'ws-transient', 2, '503 Service Unavailable');

    await reapplyV14(d);

    const r = row(d, 'ws-transient');
    expect(r.attempt).toBe(2);
    expect(r.err).not.toBeNull();
  });

  it('идемпотентна: повторный прогон ничего не ломает', async () => {
    const d = await freshDb();
    await runMigrations(webMigrationApi(d));
    insertOutbox(d, 'workspaces', 'ws-rls2', 5, '[permanent] row-level security');

    await reapplyV14(d);
    const first = row(d, 'ws-rls2');
    expect(first.attempt).toBe(0);

    // Повторный накат — строка уже сброшена, маркеров нет, изменений не будет.
    await reapplyV14(d);
    const second = row(d, 'ws-rls2');
    expect(second.attempt).toBe(0);
    expect(second.err).toBeNull();
  });

  it('MIGRATIONS содержит v14 и TARGET_VERSION >= 14', () => {
    const v14 = MIGRATIONS.find((m) => m.version === 14);
    expect(v14).toBeDefined();
    expect(v14!.description.toLowerCase()).toContain('outbox');
    expect(TARGET_VERSION).toBeGreaterThanOrEqual(14);
  });
});
