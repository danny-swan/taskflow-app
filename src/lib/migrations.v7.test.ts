/**
 * Тест миграции v7 (outbox backfill): проверяем что после накатки все живые
 * строки (deleted_at IS NULL) с валидным uuid попадают в sync_outbox
 * с op='upsert', удалённые НЕ попадают, а повторный запуск ничего не портит.
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

/**
 * Baseline v1 schema + пара задач с разным состоянием deleted_at.
 * Миграции v2-v6 добавят: task_templates, sync-колонки (uuid/deleted_at/version/
 * client_id/updated_at), sync_outbox. v7 сделает backfill.
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
  // Три статуса, два тега, три задачи (одна из них позже станет "удалённой" через
  // update deleted_at после миграций v5+, поскольку колонка deleted_at появляется в v5).
  d.run(`INSERT INTO statuses (name, color, behavior, sort_order) VALUES ('S1', '#000', 'middle', 0)`);
  d.run(`INSERT INTO statuses (name, color, behavior, sort_order) VALUES ('S2', '#111', 'middle', 1)`);
  d.run(`INSERT INTO tags (name, color, sort_order) VALUES ('T1', '#111', 0)`);
  d.run(`INSERT INTO tags (name, color, sort_order) VALUES ('T2', '#222', 1)`);
  d.run(
    `INSERT INTO tasks (title, comment, status_id, created_at, updated_at) VALUES ('Live 1','',1,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
  );
  d.run(
    `INSERT INTO tasks (title, comment, status_id, created_at, updated_at) VALUES ('Live 2','',1,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
  );
  d.run(
    `INSERT INTO tasks (title, comment, status_id, created_at, updated_at) VALUES ('To be deleted','',1,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
  );
  return d;
}

function countOutbox(d: Database, whereClause = ''): number {
  const sql = `SELECT COUNT(*) FROM sync_outbox ${whereClause}`.trim();
  return d.exec(sql)[0].values[0][0] as number;
}

describe('migration v7 (outbox backfill)', () => {
  it('backfill всех живых строк из tasks/tags/statuses с op=upsert', async () => {
    const d = await freshDb();
    await runMigrations(webMigrationApi(d));

    const uv = d.exec('PRAGMA user_version')[0].values[0][0];
    expect(uv).toBeGreaterThanOrEqual(7);

    // 3 задачи + 2 тега + 2 статуса + seed task_templates (1 строка из v2) =
    // как минимум 8 upsert-записей. Не привязываемся к точному числу,
    // потому что v2 может засеять переменное количество шаблонов.
    const totalTasks = countOutbox(d, "WHERE entity_table='tasks' AND op='upsert'");
    expect(totalTasks).toBe(3);

    const totalTags = countOutbox(d, "WHERE entity_table='tags' AND op='upsert'");
    expect(totalTags).toBe(2);

    const totalStatuses = countOutbox(d, "WHERE entity_table='statuses' AND op='upsert'");
    expect(totalStatuses).toBe(2);

    // Все op — 'upsert', нет 'delete'.
    const deleteCount = countOutbox(d, "WHERE op='delete'");
    expect(deleteCount).toBe(0);
  });

  it('пропускает удалённые строки (deleted_at IS NOT NULL)', async () => {
    const d = await freshDb();
    // Мигрируем до v5 (uuid + deleted_at появляются в v5). Легче: гоняем полностью,
    // потом помечаем одну задачу удалённой и запускаем миграции повторно —
    // но повторный запуск v7 не сработает (user_version уже 7). Поэтому
    // тестируем через новый db с pre-populated deleted строкой ПОСЛЕ v6.
    const dOnlyToV6 = await freshDb();

    // Применяем только миграции до v6 включительно, но НЕ v7.
    // Хак: временно урезаем MIGRATIONS. Здесь проще — гоняем полностью,
    // затем удалим backfill-записи для tasks и восстановим сценарий.
    await runMigrations(webMigrationApi(dOnlyToV6));

    // Дальше сценарий: третья задача становится удалённой уже после backfill'а.
    // v7 не должен её удалить, но и повторный запуск не должен её добавить
    // (собственно проверка — на другом инстансе с deleted_at ДО backfill'а).
    // Проще: свежая БД, руками симулируем что после v5 задача была помечена deleted,
    // и запускаем миграции.
    const dPre = await freshDb();
    // Прогоняем v1..v6 через runMigrations и потом руками:
    await runMigrations(webMigrationApi(dPre));
    // Стираем backfill v7 и помечаем строку удалённой, а user_version откатим на 6.
    dPre.run(`DELETE FROM sync_outbox`);
    dPre.run(`UPDATE tasks SET deleted_at = datetime('now') WHERE title = 'To be deleted'`);
    dPre.run(`PRAGMA user_version = 6`);

    // Второй прогон runMigrations должен снова накатить v7.
    await runMigrations(webMigrationApi(dPre));

    const uv = dPre.exec('PRAGMA user_version')[0].values[0][0];
    expect(uv).toBeGreaterThanOrEqual(7);

    // Только 2 live-задачи попали в outbox.
    const liveTasks = countOutbox(dPre, "WHERE entity_table='tasks' AND op='upsert'");
    expect(liveTasks).toBe(2);

    // Удалённая задача имеет uuid, но НЕ должна попасть в outbox.
    const deletedUuidRow = dPre.exec(
      `SELECT uuid FROM tasks WHERE title = 'To be deleted'`,
    )[0].values[0][0] as string;
    const outboxForDeleted = dPre.exec(
      `SELECT COUNT(*) FROM sync_outbox WHERE entity_uuid = ?`,
      [deletedUuidRow],
    )[0].values[0][0] as number;
    expect(outboxForDeleted).toBe(0);
  });

  it('идемпотентна: повторный runMigrations ничего не дублирует', async () => {
    const d = await freshDb();
    await runMigrations(webMigrationApi(d));
    const firstCount = countOutbox(d);

    // Повторный запуск не должен применять v7 повторно (user_version уже 7).
    await runMigrations(webMigrationApi(d));
    const secondCount = countOutbox(d);

    expect(secondCount).toBe(firstCount);
  });

  it('не перезаписывает outbox-запись, которую пользователь успел обновить между v6 и v7', async () => {
    const d = await freshDb();
    await runMigrations(webMigrationApi(d));
    // Симулируем: пользователь в dev.2 (после v6, до v7) удалил задачу →
    // в outbox есть запись с op='delete'.
    const uuidRow = d.exec(`SELECT uuid FROM tasks LIMIT 1`)[0].values[0][0] as string;
    d.run(`DELETE FROM sync_outbox WHERE entity_uuid = ?`, [uuidRow]);
    d.run(
      `INSERT INTO sync_outbox (entity_table, entity_uuid, op) VALUES ('tasks', ?, 'delete')`,
      [uuidRow],
    );
    d.run(`PRAGMA user_version = 6`);

    // Повторный runMigrations — v7 накатывается снова. INSERT OR IGNORE НЕ должен
    // затронуть уже существующую 'delete'-запись.
    await runMigrations(webMigrationApi(d));

    const row = d.exec(
      `SELECT op FROM sync_outbox WHERE entity_uuid = ?`,
      [uuidRow],
    )[0].values[0];
    expect(row[0]).toBe('delete');
  });

  it('MIGRATIONS содержит v7 с корректным описанием', () => {
    const v7 = MIGRATIONS.find((m) => m.version === 7);
    expect(v7).toBeDefined();
    expect(v7?.description.toLowerCase()).toContain('backfill');
    expect(v7?.description.toLowerCase()).toContain('sync_outbox');
  });
});
