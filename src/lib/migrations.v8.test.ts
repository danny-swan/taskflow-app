/**
 * Тест миграции v8 (account-bound DB): проверяем, что после накатки в settings
 * появляется пустой реестр снимков `snapshot_registry_v1 = '[]'`, а ключ
 * `bound_user_id` НЕ создаётся заранее (отсутствие строки = «база не привязана» —
 * фундамент всей логики AccountSwitchGate). Плюс идемпотентность и то, что
 * миграция на «старой» базе с реальными задачами ничего не ломает.
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

/**
 * Baseline v1 schema с парой живых задач/тегов/статусов. Миграции v2-v7 доведут
 * схему до состояния перед v8 (sync-колонки, sync_outbox, backfill), v8 добавит
 * snapshot_registry_v1 в settings.
 */
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
  d.run(`INSERT INTO tags (name, color, sort_order) VALUES ('T1', '#111', 0)`);
  d.run(
    `INSERT INTO tasks (title, comment, status_id, created_at, updated_at) VALUES ('Live 1','',1,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
  );
  return d;
}

/** Прочитать значение settings.key или undefined, если строки нет. */
function settingValue(d: Database, key: string): string | undefined {
  const res = d.exec(`SELECT value FROM settings WHERE key = ?`, [key]);
  if (!res.length || !res[0].values.length) return undefined;
  return res[0].values[0][0] as string;
}

describe('migration v8 (account-bound DB + snapshot registry)', () => {
  it('после накатки snapshot_registry_v1 = "[]" в settings', async () => {
    const d = await freshDb();
    await runMigrations(webMigrationApi(d));

    const uv = d.exec('PRAGMA user_version')[0].values[0][0] as number;
    expect(uv).toBeGreaterThanOrEqual(8);

    expect(settingValue(d, 'snapshot_registry_v1')).toBe('[]');
  });

  it('bound_user_id НЕ создаётся заранее (отсутствие = «не привязана»)', async () => {
    const d = await freshDb();
    await runMigrations(webMigrationApi(d));

    // Строки в settings быть не должно — это критично для checkAccountBinding:
    // отсутствие ключа трактуется как «база ещё не привязана», гейт не показывается.
    expect(settingValue(d, 'bound_user_id')).toBeUndefined();
  });

  it('идемпотентна: не перетирает уже заполненный реестр при повторном запуске', async () => {
    const d = await freshDb();
    await runMigrations(webMigrationApi(d));

    // Пользователь успел создать снимок → в реестре есть запись.
    const registry = JSON.stringify([{ id: 'snap-1', label: 'manual', createdAt: '2026-07-08T00:00:00Z' }]);
    d.run(`UPDATE settings SET value = ? WHERE key = 'snapshot_registry_v1'`, [registry]);
    // И привязали базу к аккаунту.
    d.run(`INSERT INTO settings (key, value) VALUES ('bound_user_id', 'user-A')`);

    // Откатываем user_version на 7 и повторяем миграции — v8 накатится снова.
    d.run(`PRAGMA user_version = 7`);
    await runMigrations(webMigrationApi(d));

    // INSERT OR IGNORE не должен затереть непустой реестр.
    expect(settingValue(d, 'snapshot_registry_v1')).toBe(registry);
    // И не должен тронуть уже выставленную привязку.
    expect(settingValue(d, 'bound_user_id')).toBe('user-A');
  });

  it('старая база с реальными задачами: v8 ничего не ломает', async () => {
    const d = await freshDb();
    await runMigrations(webMigrationApi(d));

    // Живые данные на месте после миграций.
    const taskCount = d.exec(`SELECT COUNT(*) FROM tasks`)[0].values[0][0] as number;
    expect(taskCount).toBe(1);
    const tagCount = d.exec(`SELECT COUNT(*) FROM tags`)[0].values[0][0] as number;
    expect(tagCount).toBe(1);

    // Реестр появился, но данные не тронуты.
    expect(settingValue(d, 'snapshot_registry_v1')).toBe('[]');
  });

  it('MIGRATIONS содержит v8 с корректным описанием', () => {
    const v8 = MIGRATIONS.find((m) => m.version === 8);
    expect(v8).toBeDefined();
    const desc = v8!.description.toLowerCase();
    expect(desc).toContain('bound_user_id');
    expect(desc).toContain('snapshot_registry_v1');
    // v8 — последняя зарегистрированная миграция на момент dev.6.9.x.
    expect(TARGET_VERSION).toBeGreaterThanOrEqual(8);
  });
});
