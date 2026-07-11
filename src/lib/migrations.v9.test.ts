/**
 * Тест миграции v9 (v0.9.35-dev.6.10.0) — починка seed-строк без uuid.
 *
 * Контекст бага: tauriSeed()/seed() вызывались ПОСЛЕ runMigrations(), поэтому
 * seed-статусы/теги/welcome-задача создавались без uuid/updated_at/client_id.
 * v5 (backfill uuid) и v7 (backfill sync_outbox) отрабатывали на пустой базе и
 * этих строк не касались → enqueueOutbox молча их пропускал → push никогда их
 * не отправлял. Именно поэтому у test1 в облаке было 7 задач, но 0 статусов/тегов.
 *
 * v9 при обновлении существующей базы находит все строки с uuid = NULL, проставляет
 * им uuid + updated_at + client_id и добавляет в sync_outbox.
 *
 * Здесь мы:
 *   1. Прогоняем все миграции (база доходит до TARGET_VERSION).
 *   2. Имитируем «сломанный seed»: вставляем статус/тег/задачу с uuid = NULL
 *      (ровно так, как их создавал seed() до фикса).
 *   3. Чистим sync_outbox (чтобы наглядно видеть, что добавит именно v9).
 *   4. Откатываем user_version на 8 и повторяем миграции → v9 накатывается заново.
 *   5. Проверяем: у всех строк появился uuid/updated_at/client_id и они попали
 *      в sync_outbox. Плюс идемпотентность (повторный прогон не плодит дубли).
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

/** Baseline v1 схема (statuses/tags/tasks/settings). Миграции доведут до TARGET_VERSION. */
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

/**
 * Имитация «сломанного seed»: вставляем статус/тег/задачу БЕЗ uuid (как это
 * делал seed() до фикса). updated_at у задачи задаём (NOT NULL в схеме), а у
 * статуса/тега updated_at добавлен миграцией v5 и допускает NULL — оставляем NULL,
 * чтобы v9 его тоже проставила.
 */
function insertBrokenSeed(d: Database): void {
  // Статус: uuid=NULL, updated_at=NULL, client_id=NULL.
  d.run(
    `INSERT INTO statuses (name, color, behavior, sort_order, is_seed, uuid, updated_at, client_id)
     VALUES ('SeedStatus', '#000', 'top', 0, 1, NULL, NULL, NULL)`,
  );
  // Тег: uuid=NULL, updated_at=NULL, client_id=NULL.
  d.run(
    `INSERT INTO tags (name, color, sort_order, uuid, updated_at, client_id)
     VALUES ('SeedTag', '#111', 0, NULL, NULL, NULL)`,
  );
  // Welcome-задача: uuid=NULL, client_id=NULL (updated_at NOT NULL в схеме — задаём).
  const sid = d.exec(`SELECT id FROM statuses WHERE name='SeedStatus'`)[0].values[0][0] as number;
  d.run(
    `INSERT INTO tasks (title, comment, status_id, created_at, updated_at, uuid, client_id)
     VALUES ('Welcome', '', ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, NULL)`,
    [sid],
  );
}

/** Кол-во строк без uuid в таблице. */
function nullUuidCount(d: Database, table: string): number {
  return d.exec(`SELECT COUNT(*) FROM ${table} WHERE uuid IS NULL`)[0].values[0][0] as number;
}

/** Кол-во записей в sync_outbox для конкретной таблицы. */
function outboxCount(d: Database, entityTable: string): number {
  return d.exec(
    `SELECT COUNT(*) FROM sync_outbox WHERE entity_table = ?`,
    [entityTable],
  )[0].values[0][0] as number;
}

describe('migration v9 (fix seed rows without uuid)', () => {
  it('проставляет uuid всем строкам без него (statuses/tags/tasks)', async () => {
    const d = await freshDb();
    await runMigrations(webMigrationApi(d));
    insertBrokenSeed(d);

    // До v9: есть строки без uuid.
    expect(nullUuidCount(d, 'statuses')).toBe(1);
    expect(nullUuidCount(d, 'tags')).toBe(1);
    expect(nullUuidCount(d, 'tasks')).toBe(1);

    // Откатываем на 8 и накатываем v9 заново.
    d.run(`PRAGMA user_version = 8`);
    await runMigrations(webMigrationApi(d));

    // После v9: строк без uuid не осталось.
    expect(nullUuidCount(d, 'statuses')).toBe(0);
    expect(nullUuidCount(d, 'tags')).toBe(0);
    expect(nullUuidCount(d, 'tasks')).toBe(0);
  });

  it('проставляет updated_at и client_id там, где они были NULL', async () => {
    const d = await freshDb();
    await runMigrations(webMigrationApi(d));
    insertBrokenSeed(d);

    d.run(`PRAGMA user_version = 8`);
    await runMigrations(webMigrationApi(d));

    // updated_at и client_id непустые у всех сидов.
    const st = d.exec(`SELECT uuid, updated_at, client_id FROM statuses WHERE name='SeedStatus'`)[0].values[0];
    expect(st[0]).toBeTruthy(); // uuid
    expect(st[1]).toBeTruthy(); // updated_at
    expect(st[2]).toBeTruthy(); // client_id

    const tg = d.exec(`SELECT uuid, updated_at, client_id FROM tags WHERE name='SeedTag'`)[0].values[0];
    expect(tg[0]).toBeTruthy();
    expect(tg[1]).toBeTruthy();
    expect(tg[2]).toBeTruthy();
  });

  it('добавляет починенные строки в sync_outbox', async () => {
    const d = await freshDb();
    await runMigrations(webMigrationApi(d));
    insertBrokenSeed(d);

    // Чистим outbox, чтобы видеть только то, что добавит v9.
    d.run(`DELETE FROM sync_outbox`);
    expect(outboxCount(d, 'statuses')).toBe(0);

    d.run(`PRAGMA user_version = 8`);
    await runMigrations(webMigrationApi(d));

    // Каждая живая строка теперь в очереди на push.
    expect(outboxCount(d, 'statuses')).toBe(1);
    expect(outboxCount(d, 'tags')).toBe(1);
    expect(outboxCount(d, 'tasks')).toBe(1);
  });

  it('идемпотентна: повторный прогон v9 не плодит дубли в outbox', async () => {
    const d = await freshDb();
    await runMigrations(webMigrationApi(d));
    insertBrokenSeed(d);
    d.run(`DELETE FROM sync_outbox`);

    // Первый прогон v9.
    d.run(`PRAGMA user_version = 8`);
    await runMigrations(webMigrationApi(d));
    const after1 = outboxCount(d, 'statuses');

    // Второй прогон v9 (снова откат на 8).
    d.run(`PRAGMA user_version = 8`);
    await runMigrations(webMigrationApi(d));
    const after2 = outboxCount(d, 'statuses');

    expect(after1).toBe(1);
    // INSERT OR IGNORE не должен создать вторую запись для того же uuid.
    expect(after2).toBe(1);
  });

  it('чистая база без сломанных сидов: v9 отрабатывает без ошибок', async () => {
    const d = await freshDb();
    await runMigrations(webMigrationApi(d));

    // Ни одной строки без uuid (база пустая).
    expect(nullUuidCount(d, 'statuses')).toBe(0);
    // user_version дошёл минимум до 9.
    const uv = d.exec('PRAGMA user_version')[0].values[0][0] as number;
    expect(uv).toBeGreaterThanOrEqual(9);
  });

  it('MIGRATIONS содержит v9 с корректным описанием', () => {
    const v9 = MIGRATIONS.find((m) => m.version === 9);
    expect(v9).toBeDefined();
    const desc = v9!.description.toLowerCase();
    expect(desc).toContain('seed');
    expect(desc).toContain('uuid');
    expect(TARGET_VERSION).toBeGreaterThanOrEqual(9);
  });
});
