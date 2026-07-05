/**
 * Тест миграции v5 (sync foundation): проверяем что после накатки
 * добавляются все sync-колонки, UUID бэкфиллится, client_id генерится,
 * а идемпотентность (повторный вызов) не ломает данные.
 */
import { describe, it, expect } from 'vitest';
import initSqlJs, { type Database } from 'sql.js';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runMigrations, webMigrationApi, MIGRATIONS } from './migrations';
import { isUuidV7 } from './uuid';

// В node/vitest '?url' даёт абсолютный путь /node_modules/... — не резолвится.
// Резолвим wasm через require.resolve и грузим байты напрямую.
const req = createRequire(import.meta.url);
const WASM_PATH = req.resolve('sql.js/dist/sql-wasm.wasm');
// sql.js ждёт ArrayBuffer, а readFileSync возвращает Buffer — берём
// его underlying buffer, слайсив по (byteOffset, byteLength).
const _wasmBuf = readFileSync(WASM_PATH);
const WASM_BYTES = _wasmBuf.buffer.slice(
  _wasmBuf.byteOffset,
  _wasmBuf.byteOffset + _wasmBuf.byteLength,
) as ArrayBuffer;

async function freshDb(): Promise<Database> {
  const SQL = await initSqlJs({ wasmBinary: WASM_BYTES });
  const d = new SQL.Database();
  // Мимикрим начальную схему (baseline v1) — только то, что нужно миграциям.
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
  // Немного данных.
  d.run(`INSERT INTO statuses (name, color, behavior, sort_order) VALUES ('S1', '#000', 'middle', 0)`);
  d.run(`INSERT INTO tags (name, color, sort_order) VALUES ('T1', '#111', 0)`);
  d.run(
    `INSERT INTO tasks (title, comment, status_id, created_at, updated_at) VALUES ('Task 1','',1,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
  );
  return d;
}

describe('migration v5 (sync foundation)', () => {
  it('добавляет sync-колонки во все таблицы и бэкфиллит uuid', async () => {
    const d = await freshDb();
    await runMigrations(webMigrationApi(d));

    // v5 применилась.
    const uv = d.exec('PRAGMA user_version')[0].values[0][0];
    expect(uv).toBe(5);

    // Колонки есть в tasks.
    const cols = d.exec("PRAGMA table_info('tasks')")[0].values.map((r: any) => r[1]);
    expect(cols).toContain('uuid');
    expect(cols).toContain('deleted_at');
    expect(cols).toContain('version');
    expect(cols).toContain('client_id');

    // UUID бэкфиллен для существующей задачи.
    const uuidRow = d.exec('SELECT uuid FROM tasks WHERE id=1')[0].values[0][0] as string;
    expect(uuidRow).toBeTruthy();
    expect(isUuidV7(uuidRow)).toBe(true);

    // client_id создан в settings и подставлен в строку.
    const cid = d.exec("SELECT value FROM settings WHERE key='client_id'")[0].values[0][0] as string;
    expect(isUuidV7(cid)).toBe(true);
    const taskClient = d.exec('SELECT client_id FROM tasks WHERE id=1')[0].values[0][0] as string;
    expect(taskClient).toBe(cid);
  });

  it('идемпотентна: повторный вызов ничего не ломает', async () => {
    const d = await freshDb();
    await runMigrations(webMigrationApi(d));
    const uuidBefore = d.exec('SELECT uuid FROM tasks WHERE id=1')[0].values[0][0];

    // Повторно.
    await runMigrations(webMigrationApi(d));
    const uuidAfter = d.exec('SELECT uuid FROM tasks WHERE id=1')[0].values[0][0];
    expect(uuidAfter).toBe(uuidBefore);

    const uv = d.exec('PRAGMA user_version')[0].values[0][0];
    expect(uv).toBe(5);
  });

  it('MIGRATIONS содержит v5 с корректным описанием', () => {
    const v5 = MIGRATIONS.find((m) => m.version === 5);
    expect(v5).toBeDefined();
    expect(v5?.description).toContain('Sync foundation');
  });
});
