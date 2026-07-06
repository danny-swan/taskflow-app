/**
 * Integration-тест стора: подменяем ../lib/db на реальную sql.js in-memory базу,
 * накатываем все миграции, затем вызываем action'ы стора и проверяем реальные
 * SELECT'ы (uuid, version, sync_outbox).
 *
 * Это отличается от useStore.test.ts, где db.ts замокан на no-op — там тестируем
 * derived-хелперы. Здесь — реальную запись в sqlite + outbox.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import initSqlJs, { type Database } from 'sql.js';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runMigrations, webMigrationApi } from '../lib/migrations';

const req = createRequire(import.meta.url);
const WASM_PATH = req.resolve('sql.js/dist/sql-wasm.wasm');
const _wasmBuf = readFileSync(WASM_PATH);
const WASM_BYTES = _wasmBuf.buffer.slice(
  _wasmBuf.byteOffset,
  _wasmBuf.byteOffset + _wasmBuf.byteLength,
) as ArrayBuffer;

// Live handle на текущую sql.js базу — используется мок db.ts.
let liveDb: Database | null = null;

// Мокаем db.ts на реальную sql.js базу через liveDb.
vi.mock('../lib/db', () => ({
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
    const rs = liveDb.exec('SELECT changes() AS c, last_insert_rowid() AS i')[0];
    const c = (rs?.values[0]?.[0] as number) ?? 0;
    const i = (rs?.values[0]?.[1] as number) ?? 0;
    return { changes: c, lastInsertRowid: i };
  }),
  exec: vi.fn((sql: string) => {
    if (!liveDb) return;
    liveDb.exec(sql);
  }),
  save: vi.fn(async () => {}),
}));

vi.mock('../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Импортируем store ПОСЛЕ моков — иначе он захватит настоящий db.ts.
import { useStore } from './useStore';

/**
 * Готовит свежую sql.js базу с накаченными миграциями v1..v7 + пара seed-строк
 * (один статус, один тег), чтобы addTask/updateTag было куда писать.
 */
async function freshDb(): Promise<Database> {
  const SQL = await initSqlJs({ wasmBinary: WASM_BYTES });
  const d = new SQL.Database();
  // Baseline v1 схема (аналогично migrations.v7.test.ts).
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
  d.run(`INSERT INTO statuses (name, color, behavior, sort_order) VALUES ('В работе', '#4A90E2', 'middle', 0)`);
  d.run(`INSERT INTO statuses (name, color, behavior, sort_order) VALUES ('Готово', '#7ED321', 'archive', 1)`);
  d.run(`INSERT INTO tags (name, color, sort_order) VALUES ('Work', '#111', 0)`);

  // Накатываем все доступные миграции (текущая вершина — v7).
  await runMigrations(webMigrationApi(d));
  return d;
}

/**
 * Хелпер для инспекции outbox.
 */
function outboxAll(d: Database) {
  const stmt = d.prepare(
    'SELECT id, entity_table, entity_uuid, op FROM sync_outbox ORDER BY id',
  );
  const rows: Array<{ id: number; entity_table: string; entity_uuid: string; op: string }> = [];
  while (stmt.step()) rows.push(stmt.getAsObject() as any);
  stmt.free();
  return rows;
}

beforeEach(async () => {
  liveDb?.close();
  liveDb = await freshDb();
  // Сбрасываем стор в дефолтное состояние + подхватываем свежие данные.
  useStore.setState({
    ready: true,
    statuses: [],
    tags: [],
    tasks: [],
    templates: [],
    toasts: [],
    timezone: 'Europe/Moscow',
  } as any);
  useStore.getState().refresh();
});

describe('store integration — addTask/updateTask/soft-delete → outbox', () => {
  it('addTask пишет uuid + version=1 в tasks и upsert в outbox', () => {
    // Очищаем outbox после backfill v7 seed-строк — интересует только эффект addTask.
    liveDb!.run('DELETE FROM sync_outbox');
    const statusId = useStore.getState().statuses[0].id;
    const taskId = useStore.getState().addTask({ title: 'Тест 1', status_id: statusId });

    const row = liveDb!.exec(
      `SELECT id, title, uuid, version, client_id FROM tasks WHERE id=${taskId}`,
    )[0];
    expect(row).toBeDefined();
    const [, title, uuid, version, clientId] = row.values[0];
    expect(title).toBe('Тест 1');
    expect(typeof uuid).toBe('string');
    expect((uuid as string).length).toBeGreaterThan(10);
    expect(version).toBe(1);
    expect(typeof clientId).toBe('string');

    const ob = outboxAll(liveDb!);
    expect(ob.length).toBe(1);
    expect(ob[0].entity_table).toBe('tasks');
    expect(ob[0].entity_uuid).toBe(uuid);
    expect(ob[0].op).toBe('upsert');
  });

  it('updateTask бампает version и добавляет запись в outbox', () => {
    const statusId = useStore.getState().statuses[0].id;
    const taskId = useStore.getState().addTask({ title: 'Draft', status_id: statusId });

    // clear outbox после INSERT'а
    liveDb!.run('DELETE FROM sync_outbox');

    useStore.getState().updateTask(taskId, { title: 'Final' });

    const row = liveDb!.exec(
      `SELECT title, version FROM tasks WHERE id=${taskId}`,
    )[0];
    expect(row.values[0][0]).toBe('Final');
    expect(row.values[0][1]).toBe(2);

    const ob = outboxAll(liveDb!);
    expect(ob.length).toBe(1);
    expect(ob[0].op).toBe('upsert');
    expect(ob[0].entity_table).toBe('tasks');
  });

  it('softDeleteTask помечает archived + version++ + upsert в outbox', () => {
    const statusId = useStore.getState().statuses[0].id;
    const taskId = useStore.getState().addTask({ title: 'To soft-delete', status_id: statusId });
    liveDb!.run('DELETE FROM sync_outbox');

    useStore.getState().softDeleteTask(taskId);

    // archived=1, deleted_at по-прежнему NULL (soft delete в нашей модели =
    // перевод в "Удалено"-статус или archived=1, а не deleted_at)
    const row = liveDb!.exec(
      `SELECT archived, deleted_at, version FROM tasks WHERE id=${taskId}`,
    )[0];
    expect(row.values[0][0]).toBe(1);
    // deleted_at может остаться NULL — это upsert, не delete
    expect(row.values[0][2]).toBe(2);

    const ob = outboxAll(liveDb!);
    expect(ob.length).toBe(1);
    expect(ob[0].op).toBe('upsert');
  });

  it('permanentlyDeleteTask ставит deleted_at и пишет op=delete в outbox', () => {
    const statusId = useStore.getState().statuses[0].id;
    const taskId = useStore.getState().addTask({ title: 'To hard-delete', status_id: statusId });
    liveDb!.run('DELETE FROM sync_outbox');

    useStore.getState().permanentlyDeleteTask(taskId);

    const row = liveDb!.exec(
      `SELECT deleted_at, version FROM tasks WHERE id=${taskId}`,
    )[0];
    expect(row.values[0][0]).not.toBeNull();
    expect(row.values[0][1]).toBe(2);

    const ob = outboxAll(liveDb!);
    expect(ob.length).toBe(1);
    expect(ob[0].op).toBe('delete');
    expect(ob[0].entity_table).toBe('tasks');
  });
});

describe('store integration — outbox dedup roundtrip', () => {
  it('3 updateTask подряд → одна запись в outbox (dedup по uuid+op)', () => {
    // Очищаем outbox после backfill'а.
    liveDb!.run('DELETE FROM sync_outbox');
    const statusId = useStore.getState().statuses[0].id;
    const taskId = useStore.getState().addTask({ title: 'v1', status_id: statusId });
    // Одна запись в outbox после INSERT'а — не удаляем её, чтобы проверить полный dedup.

    useStore.getState().updateTask(taskId, { title: 'v2' });
    useStore.getState().updateTask(taskId, { title: 'v3' });
    useStore.getState().updateTask(taskId, { title: 'v4' });

    // После INSERT + 3 UPDATE version должен быть 4.
    const row = liveDb!.exec(
      `SELECT title, version FROM tasks WHERE id=${taskId}`,
    )[0];
    expect(row.values[0][0]).toBe('v4');
    expect(row.values[0][1]).toBe(4);

    // Но в outbox — ровно ОДНА запись (INSERT OR IGNORE по (entity_table, entity_uuid, op)).
    const ob = outboxAll(liveDb!);
    expect(ob.length).toBe(1);
    expect(ob[0].op).toBe('upsert');
  });
});

describe('store integration — deleteTag cascade', () => {
  it('deleteTag → outbox содержит delete-тега + upsert для affected tasks', () => {
    const statusId = useStore.getState().statuses[0].id;
    const tagId = useStore.getState().addTag('Urgent', '#F00');
    const t1 = useStore.getState().addTask({ title: 'A', status_id: statusId, tag_id: tagId });
    const t2 = useStore.getState().addTask({ title: 'B', status_id: statusId, tag_id: tagId });
    const t3 = useStore.getState().addTask({ title: 'C (no tag)', status_id: statusId });

    // Соберём uuid'ы задач для проверки.
    const uuidA = liveDb!.exec(`SELECT uuid FROM tasks WHERE id=${t1}`)[0].values[0][0] as string;
    const uuidB = liveDb!.exec(`SELECT uuid FROM tasks WHERE id=${t2}`)[0].values[0][0] as string;
    const uuidC = liveDb!.exec(`SELECT uuid FROM tasks WHERE id=${t3}`)[0].values[0][0] as string;
    const uuidTag = liveDb!.exec(`SELECT uuid FROM tags WHERE id=${tagId}`)[0].values[0][0] as string;

    // Сбрасываем outbox после начальных INSERT'ов.
    liveDb!.run('DELETE FROM sync_outbox');

    useStore.getState().deleteTag(tagId);

    const ob = outboxAll(liveDb!);
    // Ожидаем: 1 delete-тега + 2 upsert-задачи (A и B, у которых был tag_id).
    // Задача C без тега — её version не бампался, в outbox не попадает.
    const tagRows = ob.filter(r => r.entity_table === 'tags');
    const taskRows = ob.filter(r => r.entity_table === 'tasks');

    expect(tagRows.length).toBe(1);
    expect(tagRows[0].entity_uuid).toBe(uuidTag);
    expect(tagRows[0].op).toBe('delete');

    expect(taskRows.length).toBe(2);
    const affectedUuids = taskRows.map(r => r.entity_uuid).sort();
    expect(affectedUuids).toEqual([uuidA, uuidB].sort());
    expect(taskRows.every(r => r.op === 'upsert')).toBe(true);
    expect(affectedUuids.includes(uuidC)).toBe(false);
  });
});
