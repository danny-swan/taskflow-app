/**
 * Тест миграции v6 (sync outbox): проверяем что таблица sync_outbox и её
 * индексы создаются, UNIQUE(entity_table, entity_uuid) работает как dedup,
 * а идемпотентность (повторный запуск) не ломает данные.
 */
import { describe, it, expect } from 'vitest';
import initSqlJs, { type Database } from 'sql.js';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runMigrations, webMigrationApi, MIGRATIONS } from './migrations';

const req = createRequire(import.meta.url);
const WASM_PATH = req.resolve('sql.js/dist/sql-wasm.wasm');
const _wasmBuf = readFileSync(WASM_PATH);
const WASM_BYTES = _wasmBuf.buffer.slice(
  _wasmBuf.byteOffset,
  _wasmBuf.byteOffset + _wasmBuf.byteLength,
) as ArrayBuffer;

/** Baseline v1 schema (то же, что и в v5-тесте). */
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
  d.run(`INSERT INTO statuses (name, color, behavior, sort_order) VALUES ('S1', '#000', 'middle', 0)`);
  return d;
}

describe('migration v6 (sync outbox)', () => {
  it('создаёт таблицу sync_outbox с нужными колонками', async () => {
    const d = await freshDb();
    await runMigrations(webMigrationApi(d));

    const uv = d.exec('PRAGMA user_version')[0].values[0][0];
    expect(uv).toBeGreaterThanOrEqual(6);

    const cols = d.exec("PRAGMA table_info('sync_outbox')")[0].values.map((r: any) => r[1]);
    expect(cols).toEqual(
      expect.arrayContaining([
        'id',
        'entity_table',
        'entity_uuid',
        'op',
        'queued_at',
        'last_attempt_at',
        'attempt_count',
        'last_error',
      ]),
    );
  });

  it('создаёт UNIQUE-индекс по (entity_table, entity_uuid) и FIFO-индекс по queued_at', async () => {
    const d = await freshDb();
    await runMigrations(webMigrationApi(d));

    const idxRows = d.exec(
      "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='sync_outbox'",
    )[0]?.values.map((r: any) => r[0] as string) ?? [];
    expect(idxRows).toContain('idx_sync_outbox_entity');
    expect(idxRows).toContain('idx_sync_outbox_queued_at');
  });

  it('UNIQUE-индекс блокирует дубликат (entity_table, entity_uuid)', async () => {
    const d = await freshDb();
    await runMigrations(webMigrationApi(d));

    d.run(
      `INSERT INTO sync_outbox (entity_table, entity_uuid, op) VALUES ('tasks', 'u-1', 'upsert')`,
    );
    // Второй INSERT без ON CONFLICT должен упасть.
    expect(() =>
      d.run(
        `INSERT INTO sync_outbox (entity_table, entity_uuid, op) VALUES ('tasks', 'u-1', 'upsert')`,
      ),
    ).toThrow();
  });

  it('ON CONFLICT DO UPDATE обновляет op и обнуляет attempt_count (dedup)', async () => {
    const d = await freshDb();
    await runMigrations(webMigrationApi(d));

    d.run(
      `INSERT INTO sync_outbox (entity_table, entity_uuid, op, attempt_count, last_error)
       VALUES ('tasks', 'u-2', 'upsert', 3, 'boom')`,
    );

    // Повторный enqueue с новым op → должен обновить строку.
    d.run(
      `INSERT INTO sync_outbox (entity_table, entity_uuid, op, queued_at, attempt_count, last_attempt_at, last_error)
       VALUES ('tasks', 'u-2', 'delete', datetime('now'), 0, NULL, NULL)
       ON CONFLICT(entity_table, entity_uuid) DO UPDATE SET
         op = excluded.op,
         queued_at = excluded.queued_at,
         attempt_count = 0,
         last_attempt_at = NULL,
         last_error = NULL`,
    );

    const row = d.exec(`SELECT op, attempt_count, last_error FROM sync_outbox WHERE entity_uuid='u-2'`)[0]
      .values[0];
    expect(row[0]).toBe('delete');
    expect(row[1]).toBe(0);
    expect(row[2]).toBeNull();

    // Всё ещё одна строка.
    const count = d.exec(`SELECT COUNT(*) FROM sync_outbox WHERE entity_uuid='u-2'`)[0].values[0][0];
    expect(count).toBe(1);
  });

  it('идемпотентна: повторный вызов не пересоздаёт данные и не ломает user_version', async () => {
    const d = await freshDb();
    await runMigrations(webMigrationApi(d));

    d.run(
      `INSERT INTO sync_outbox (entity_table, entity_uuid, op) VALUES ('tags', 'u-3', 'upsert')`,
    );

    await runMigrations(webMigrationApi(d));

    const row = d.exec(`SELECT op FROM sync_outbox WHERE entity_uuid='u-3'`)[0].values[0];
    expect(row[0]).toBe('upsert');

    const uv = d.exec('PRAGMA user_version')[0].values[0][0];
    expect(uv).toBeGreaterThanOrEqual(6);
  });

  it('MIGRATIONS содержит v6 с корректным описанием', () => {
    const v6 = MIGRATIONS.find((m) => m.version === 6);
    expect(v6).toBeDefined();
    expect(v6?.description.toLowerCase()).toContain('sync outbox');
  });
});
