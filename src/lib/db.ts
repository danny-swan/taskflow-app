/**
 * db.ts — Database adapter with two implementations:
 *  - Tauri (desktop): uses @tauri-apps/plugin-sql → native SQLite
 *  - Web (browser): uses sql.js + localStorage (unchanged)
 *
 * Public API is identical in both cases so the store does not need changes.
 */

// ─── Environment detection ────────────────────────────────────────────────────
const IS_TAURI = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__;

// ─── WEB IMPLEMENTATION (sql.js + localStorage) ──────────────────────────────
import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
// @ts-ignore
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { runMigrations, tauriMigrationApi, webMigrationApi } from './migrations';
import { uuidv7 } from './uuid';

const STORAGE_KEY = 'taskflow.sqlite.v1';
const STORAGE_KEY_TS = 'taskflow.sqlite.v1.ts';

// ─── v0.9.35-dev.6.10.3: единый источник правды для сид-справочников ──────────
// Список статусов/тегов вынесен в ./seedData, чтобы им пользовались и db.ts
// (seed/tauriSeed/ensureSeededIfEmpty), и store.createWorkspace (сев дефолтных
// статусов при создании нового ws) — без дублирования литералов.
import { SEED_STATUSES, SEED_TAGS } from './seedData';

let SQL: SqlJsStatic | null = null;
let webDb: Database | null = null;
let storageAvailable = true;

function tryStorage<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { storageAvailable = false; return fallback; }
}

function loadFromStorage(): Uint8Array | null {
  return tryStorage(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
      const arr = JSON.parse(raw) as number[];
      return new Uint8Array(arr);
    } catch { return null; }
  }, null);
}

function saveToStorage(bytes: Uint8Array) {
  tryStorage(() => {
    const arr = Array.from(bytes);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
    localStorage.setItem(STORAGE_KEY_TS, String(Date.now()));
    return null;
  }, null);
}

// ─── TAURI IMPLEMENTATION ─────────────────────────────────────────────────────
// Loaded lazily so the web build never imports the Tauri plugin.
let tauriDb: any = null; // TauriDatabase instance

async function getTauriDb(): Promise<any> {
  if (tauriDb) return tauriDb;
  // Dynamic import — tree-shaken in web builds
  const { default: TauriDatabase } = await import('@tauri-apps/plugin-sql');
  // Ask Rust for the current (possibly custom) path
  const { invoke } = await import('@tauri-apps/api/core');
  let dbPath: string;
  try {
    dbPath = await invoke<string>('get_db_path');
  } catch {
    dbPath = 'data.db';
  }
  // plugin-sql expects a URL like "sqlite:data.db" or "sqlite:/absolute/path"
  const url = dbPath.startsWith('sqlite:') ? dbPath : `sqlite:${dbPath}`;
  tauriDb = await TauriDatabase.load(url);
  return tauriDb;
}

async function tauriEnsureSchema(): Promise<void> {
  const d = await getTauriDb();
  // tauri-plugin-sql / sqlx не всегда корректно выполняет multi-statement,
  // поэтому разбиваем на отдельные вызовы execute().
  await d.execute(`CREATE TABLE IF NOT EXISTS statuses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    behavior TEXT NOT NULL DEFAULT 'middle',
    sort_order INTEGER NOT NULL,
    is_seed INTEGER NOT NULL DEFAULT 0,
    is_technical INTEGER NOT NULL DEFAULT 0
  )`);
  await d.execute(`CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
  )`);
  await d.execute(`CREATE TABLE IF NOT EXISTS tasks (
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
  )`);
  await d.execute(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`);
}

async function tauriColumnExists(table: string, col: string): Promise<boolean> {
  const d = await getTauriDb();
  const rows: any[] = await d.select(`PRAGMA table_info(${table})`);
  return rows.some((r: any) => r.name === col);
}

async function tauriMigrate(): Promise<void> {
  const d = await getTauriDb();

  // Идемпотентный ALTER: пытаемся добавить колонку; если она уже есть — игнорируем ошибку.
  // Это надёжнее, чем PRAGMA table_info(), и переживает частичные миграции.
  const safeAlter = async (sql: string) => {
    try { await d.execute(sql); }
    catch (e: any) {
      const msg = String(e?.message || e || '');
      if (!/duplicate column|already exists/i.test(msg)) {
        console.warn('[migrate] ALTER warning:', msg);
      }
    }
  };
  const safeExec = async (sql: string) => {
    try { await d.execute(sql); }
    catch (e) { console.warn('[migrate] exec warning:', e); }
  };

  await safeAlter(`ALTER TABLE tasks ADD COLUMN deadline TEXT`);
  await safeAlter(`ALTER TABLE tasks ADD COLUMN archived INTEGER NOT NULL DEFAULT 0`);
  await safeAlter(`ALTER TABLE statuses ADD COLUMN is_technical INTEGER NOT NULL DEFAULT 0`);
  await safeAlter(`ALTER TABLE statuses ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0`);
  await safeAlter(`ALTER TABLE statuses ADD COLUMN default_collapsed INTEGER NOT NULL DEFAULT 0`);

  // Пост-миграция: разовые UPDATE-ы (безопасно выполнять повторно).
  await safeExec(`UPDATE tasks SET deadline = finish_date WHERE deadline IS NULL AND finish_date IS NOT NULL`);
  await safeExec(`UPDATE statuses SET hidden=1 WHERE behavior='archive' AND is_technical=1 AND hidden=0`);
  await safeExec(`UPDATE statuses SET default_collapsed=1 WHERE behavior='archive' AND is_technical=0 AND default_collapsed=0`);

  // Ensure technical "Удалено" status exists — НО ТОЛЬКО для уже инициализированных БД.
  // На свежеустановленной (пустой) БД пропускаем — иначе tauriIsEmpty() вернёт false,
  // и seed (6 базовых статусов + теги + welcome-задача) не выполнится.
  // Для пустой БД статус «Удалено» создаст сам seed.
  try {
    const cntRows: any[] = await d.select(`SELECT COUNT(*) AS c FROM statuses`);
    const cnt = cntRows[0]?.c ?? 0;
    if (cnt > 0) {
      const rows: any[] = await d.select(`SELECT id FROM statuses WHERE is_technical=1 LIMIT 1`);
      if (rows.length === 0) {
        const maxRows: any[] = await d.select(`SELECT COALESCE(MAX(sort_order),0)+1 AS m FROM statuses`);
        const max = maxRows[0]?.m ?? 0;
        await d.execute(
          `INSERT INTO statuses (name, color, behavior, sort_order, is_seed, is_technical, hidden, default_collapsed) VALUES (?,?,?,?,?,?,?,?)`,
          ['Удалено', '#5A5957', 'archive', max, 1, 1, 1, 0]
        );
      }
    }
  } catch (e) { console.warn('[migrate] ensure Удалено:', e); }
}

async function tauriIsEmpty(): Promise<boolean> {
  const d = await getTauriDb();
  const rows: any[] = await d.select(`SELECT COUNT(*) AS cnt FROM statuses`);
  return (rows[0]?.cnt ?? 0) === 0;
}

async function tauriSeed(): Promise<void> {
  const d = await getTauriDb();
  const now = new Date().toISOString();

  // v0.9.35-dev.6.10.0: читаем client_id (проставлен миграцией v5/v9).
  // Если по какой-то причине его нет — продолжаем без него (второстепенный атрибут).
  const cidRows: any[] = await d.select(`SELECT value FROM settings WHERE key='client_id'`);
  const clientId: string | null = cidRows[0]?.value ?? null;

  // Wave A (workspaces): id personal-пространства для штампа seed-строк.
  // v11-миграция пишет settings.personal_workspace_id ДО seed(); читаем его,
  // чтобы засеянные статусы/теги/welcome-задача получили workspace_id и попадали
  // в ws-scoped выборки UI. Без этого штампа (регрессия P1) сид-строки на
  // десктопе оставались с workspace_id=NULL и не показывались в системном ws.
  const wsRows: any[] = await d.select(`SELECT value FROM settings WHERE key='personal_workspace_id'`);
  const wsId: string = (String(wsRows[0]?.value ?? '').trim()) || 'ws_local';

  // v0.9.0: «В процессе» теперь идёт ПЕРЕД «Взять в работу» — это активный статус,
  // ему логично быть выше в списке.
  // v0.9.35-dev.6.10.3: список вынесен в SEED_STATUSES (единый источник правды).
  const statuses = SEED_STATUSES;
  const statusUuids: string[] = [];
  for (let i = 0; i < statuses.length; i++) {
    const s = statuses[i];
    const uuid = uuidv7();
    statusUuids.push(uuid);
    await d.execute(
      `INSERT INTO statuses
         (uuid, name, color, behavior, sort_order, is_seed, is_technical,
          hidden, default_collapsed, updated_at, version, client_id, workspace_id)
       VALUES (?,?,?,?,?,1,?,?,?,?,1,?,?)`,
      [uuid, s.name, s.color, s.behavior, i, s.is_technical, s.hidden, s.default_collapsed, now, clientId, wsId]
    );
  }

  const tags = SEED_TAGS;
  const tagUuids: string[] = [];
  for (let i = 0; i < tags.length; i++) {
    const uuid = uuidv7();
    tagUuids.push(uuid);
    await d.execute(
      `INSERT INTO tags (uuid, name, color, sort_order, updated_at, version, client_id, workspace_id)
       VALUES (?,?,?,?,?,1,?,?)`,
      [uuid, tags[i].name, tags[i].color, i, now, clientId, wsId]
    );
  }

  // Find "Сегодня" status and "PRS" tag IDs
  const statusRows: any[] = await d.select(`SELECT id, uuid FROM statuses WHERE name='Сегодня' LIMIT 1`);
  const tagRows: any[] = await d.select(`SELECT id, uuid FROM tags WHERE name='PRS' LIMIT 1`);
  const statusId = statusRows[0]?.id ?? 1;
  const statusUuid: string | null = statusRows[0]?.uuid ?? null;
  const tagId = tagRows[0]?.id ?? null;
  const tagUuid: string | null = tagRows[0]?.uuid ?? null;

  // v0.9.31: используем локальную дату вместо UTC.
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  const todayStr = `${y}-${m}-${day}`;
  const deadline = new Date(today);
  deadline.setDate(deadline.getDate() + 3);
  const dy = deadline.getFullYear();
  const dm = String(deadline.getMonth() + 1).padStart(2, '0');
  const dd = String(deadline.getDate()).padStart(2, '0');
  const deadlineStr = `${dy}-${dm}-${dd}`;

  const taskUuid = uuidv7();
  await d.execute(
    `INSERT INTO tasks
       (uuid, title, comment, tag_id, status_id, start_date, deadline, finish_date,
        created_at, updated_at, sort_order, archived, version, client_id, workspace_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,0,1,?,?)`,
    [
      taskUuid,
      'Добро пожаловать в TaskFlow',
      'Нажмите ✓ справа, чтобы выполнить задачу, или иконка корзины 🗑 в правом верхнем углу — чтобы удалить.',
      tagId, statusId, todayStr, deadlineStr, null, now, now, 0, clientId, wsId,
    ]
  );

  // v0.9.35-dev.6.10.0: добавляем seed-строки в sync_outbox, чтобы они
  // отправились в облако при первой синхронизации.
  // Статусы: все 7.
  for (const uuid of statusUuids) {
    await d.execute(
      `INSERT OR IGNORE INTO sync_outbox (entity_table, entity_uuid, op, queued_at, attempt_count)
       VALUES ('statuses', ?, 'upsert', datetime('now'), 0)`,
      [uuid]
    );
  }
  // Теги: все 5.
  for (const uuid of tagUuids) {
    await d.execute(
      `INSERT OR IGNORE INTO sync_outbox (entity_table, entity_uuid, op, queued_at, attempt_count)
       VALUES ('tags', ?, 'upsert', datetime('now'), 0)`,
      [uuid]
    );
  }
  // Welcome-задача.
  await d.execute(
    `INSERT OR IGNORE INTO sync_outbox (entity_table, entity_uuid, op, queued_at, attempt_count)
     VALUES ('tasks', ?, 'upsert', datetime('now'), 0)`,
    [taskUuid]
  );

  // Подавляем TS-предупреждения об unused (используются для outbox выше).
  void statusUuid; void tagUuid;

  const defaults = [
    ['language', 'ru'],
    ['theme', 'light'],
    ['stats_enabled', '1'],
    ['default_tab', 'tasks'],
    ['font_size', '14'],
    // v0.9.34: автоочистка — включена по умолчанию для новых установок.
    ['autocleanup_enabled', '1'],
    ['autocleanup_mode', 'weekday'],
    ['autocleanup_day', '1'],
    ['autocleanup_min_age_days', '7'],
  ];
  for (const [k, v] of defaults) {
    await d.execute('INSERT OR IGNORE INTO settings (key, value) VALUES (?,?)', [k, v]);
  }
}

// ─── WEB HELPERS ─────────────────────────────────────────────────────────────
function ensureSchema(d: Database) {
  d.run(`
    CREATE TABLE IF NOT EXISTS statuses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      behavior TEXT NOT NULL DEFAULT 'middle',
      sort_order INTEGER NOT NULL,
      is_seed INTEGER NOT NULL DEFAULT 0,
      is_technical INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS tasks (
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
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS task_templates (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      title       TEXT    NOT NULL DEFAULT '',
      comment     TEXT    NOT NULL DEFAULT '',
      status_id   INTEGER,
      tag_id      INTEGER,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS overdue_events (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id           INTEGER NOT NULL,
      deadline_snapshot TEXT    NOT NULL,
      event_date        TEXT    NOT NULL,
      created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_overdue_events_date ON overdue_events(event_date);
    CREATE INDEX IF NOT EXISTS idx_overdue_events_task ON overdue_events(task_id, id DESC);
  `);
}

function columnExists(d: Database, table: string, col: string): boolean {
  const stmt = d.prepare(`PRAGMA table_info(${table})`);
  let exists = false;
  while (stmt.step()) {
    const row: any = stmt.getAsObject();
    if (row.name === col) { exists = true; break; }
  }
  stmt.free();
  return exists;
}

function migrate(d: Database) {
  if (!columnExists(d, 'tasks', 'deadline')) {
    d.run(`ALTER TABLE tasks ADD COLUMN deadline TEXT`);
    d.run(`UPDATE tasks SET deadline = finish_date WHERE deadline IS NULL AND finish_date IS NOT NULL`);
    d.run(`UPDATE tasks SET finish_date = NULL WHERE status_id NOT IN (SELECT id FROM statuses WHERE behavior='archive')`);
  }
  if (!columnExists(d, 'tasks', 'archived')) {
    d.run(`ALTER TABLE tasks ADD COLUMN archived INTEGER NOT NULL DEFAULT 0`);
  }
  if (!columnExists(d, 'statuses', 'is_technical')) {
    d.run(`ALTER TABLE statuses ADD COLUMN is_technical INTEGER NOT NULL DEFAULT 0`);
  }
  // v0.8.2: hidden and default_collapsed columns
  if (!columnExists(d, 'statuses', 'hidden')) {
    d.run(`ALTER TABLE statuses ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0`);
    // Migrate: archived=true → hidden=true (old behavior)
    d.run(`UPDATE statuses SET hidden=1 WHERE behavior='archive' AND is_technical=1`);
    // "Выполнено" (non-technical archive) → hidden=false, default_collapsed=true
    // will be set below in the seed check
  }
  if (!columnExists(d, 'statuses', 'default_collapsed')) {
    d.run(`ALTER TABLE statuses ADD COLUMN default_collapsed INTEGER NOT NULL DEFAULT 0`);
    // "Выполнено" behavior='archive', is_technical=0 → defaultCollapsed=true
    d.run(`UPDATE statuses SET default_collapsed=1 WHERE behavior='archive' AND is_technical=0`);
  }
  // Создаём технический статус «Удалено» ТОЛЬКО для уже инициализированных БД.
  // На пустой БД пропускаем — иначе isEmpty() вернёт false и seed не выполнится.
  const cntStmt = d.prepare(`SELECT COUNT(*) AS c FROM statuses`);
  cntStmt.step();
  const cnt = (cntStmt.getAsObject() as any).c as number;
  cntStmt.free();
  if (cnt > 0) {
    const exists = (() => {
      const stmt = d.prepare(`SELECT id FROM statuses WHERE is_technical=1 LIMIT 1`);
      const has = stmt.step();
      stmt.free();
      return has;
    })();
    if (!exists) {
      const stmt = d.prepare(`SELECT COALESCE(MAX(sort_order),0)+1 AS m FROM statuses`);
      stmt.step();
      const max = (stmt.getAsObject() as any).m as number;
      stmt.free();
      d.run(`INSERT INTO statuses (name, color, behavior, sort_order, is_seed, is_technical, hidden, default_collapsed) VALUES (?,?,?,?,?,?,?,?)`,
        ['Удалено', '#5A5957', 'archive', max, 1, 1, 1, 0]);
    }
  }
}

// Wave A (workspaces): id personal-пространства для штампа seed-строк.
// v11-миграция пишет settings.personal_workspace_id ДО seed(); читаем его,
// чтобы засеянные статусы/теги/welcome-задача получили workspace_id и попадали
// в ws-scoped выборки UI (иначе список пуст — регрессия Wave A PR-3).
function readSeedWsId(d: Database): string | null {
  try {
    const stmt = d.prepare(`SELECT value FROM settings WHERE key='personal_workspace_id' LIMIT 1`);
    let v: string | null = null;
    if (stmt.step()) v = (((stmt.getAsObject() as any).value as string) ?? '').trim() || null;
    stmt.free();
    return v ?? 'ws_local';
  } catch { return 'ws_local'; }
}

function seed(d: Database) {
  const now = new Date().toISOString();
  const wsId = readSeedWsId(d);

  // v0.9.35-dev.6.10.0: читаем client_id (проставлен миграцией v5/v9).
  const cidStmt = d.prepare(`SELECT value FROM settings WHERE key='client_id' LIMIT 1`);
  let clientId: string | null = null;
  if (cidStmt.step()) { clientId = (cidStmt.getAsObject() as any).value as string ?? null; }
  cidStmt.free();

  // v0.8.2: hidden and default_collapsed per status
  // v0.9.0: «В процессе» теперь идёт ПЕРЕД «Взять в работу»
  // v0.9.35-dev.6.10.3: список вынесен в SEED_STATUSES (единый источник правды).
  const statuses = SEED_STATUSES;
  const statusUuids: string[] = [];
  statuses.forEach((s, i) => {
    const uuid = uuidv7();
    statusUuids.push(uuid);
    d.run(
      `INSERT INTO statuses
         (uuid, name, color, behavior, sort_order, is_seed, is_technical,
          hidden, default_collapsed, updated_at, version, client_id, workspace_id)
       VALUES (?,?,?,?,?,1,?,?,?,?,1,?,?)`,
      [uuid, s.name, s.color, s.behavior, i, s.is_technical, s.hidden, s.default_collapsed, now, clientId, wsId]
    );
  });

  const tags = SEED_TAGS;
  const tagUuids: string[] = [];
  tags.forEach((t, i) => {
    const uuid = uuidv7();
    tagUuids.push(uuid);
    d.run(
      `INSERT INTO tags (uuid, name, color, sort_order, updated_at, version, client_id, workspace_id)
       VALUES (?,?,?,?,?,1,?,?)`,
      [uuid, t.name, t.color, i, now, clientId, wsId]
    );
  });

  // Welcome seed task (single task)
  // v0.9.31: локальная дата (не UTC), чтобы у пользователей в TZ +N не сдвигалось на день назад.
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  const todayStr = `${y}-${m}-${day}`;
  const deadlineDate = new Date(today);
  deadlineDate.setDate(deadlineDate.getDate() + 3);
  const dy = deadlineDate.getFullYear();
  const dm = String(deadlineDate.getMonth() + 1).padStart(2, '0');
  const dd = String(deadlineDate.getDate()).padStart(2, '0');
  const deadlineStr = `${dy}-${dm}-${dd}`;

  // Get the "Сегодня" status and "PRS" tag
  const statusStmt = d.prepare(`SELECT id FROM statuses WHERE name='Сегодня' LIMIT 1`);
  let statusId = 2;
  if (statusStmt.step()) { statusId = (statusStmt.getAsObject() as any).id as number; }
  statusStmt.free();

  const tagStmt = d.prepare(`SELECT id FROM tags WHERE name='PRS' LIMIT 1`);
  let tagId: number | null = null;
  if (tagStmt.step()) { tagId = (tagStmt.getAsObject() as any).id as number; }
  tagStmt.free();

  const taskUuid = uuidv7();
  d.run(
    `INSERT INTO tasks
       (uuid, title, comment, tag_id, status_id, start_date, deadline, finish_date,
        created_at, updated_at, sort_order, archived, version, client_id, workspace_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,0,1,?,?)`,
    [
      taskUuid,
      'Добро пожаловать в TaskFlow',
      'Нажмите ✓ справа, чтобы выполнить задачу, или иконка корзины 🗑 в правом верхнем углу — чтобы удалить.',
      tagId, statusId, todayStr, deadlineStr, null, now, now, 0, clientId, wsId,
    ]
  );

  // v0.9.35-dev.6.10.0: добавляем seed-строки в sync_outbox.
  statusUuids.forEach(uuid => {
    d.run(
      `INSERT OR IGNORE INTO sync_outbox (entity_table, entity_uuid, op, queued_at, attempt_count)
       VALUES ('statuses', ?, 'upsert', datetime('now'), 0)`,
      [uuid]
    );
  });
  tagUuids.forEach(uuid => {
    d.run(
      `INSERT OR IGNORE INTO sync_outbox (entity_table, entity_uuid, op, queued_at, attempt_count)
       VALUES ('tags', ?, 'upsert', datetime('now'), 0)`,
      [uuid]
    );
  });
  d.run(
    `INSERT OR IGNORE INTO sync_outbox (entity_table, entity_uuid, op, queued_at, attempt_count)
     VALUES ('tasks', ?, 'upsert', datetime('now'), 0)`,
    [taskUuid]
  );

  const defaults = [
    ['language', 'ru'],
    ['theme', 'light'],
    ['stats_enabled', '1'],
    ['default_tab', 'tasks'],
    ['font_size', '14'],
    // v0.9.34: автоочистка выполненных задач — включена по умолчанию для новых
    // установок. Старые БД не трогаем — INSERT OR IGNORE не перезапишет.
    ['autocleanup_enabled', '1'],
    ['autocleanup_mode', 'weekday'],
    ['autocleanup_day', '1'],
    ['autocleanup_min_age_days', '7'],
  ];
  defaults.forEach(([k, v]) => d.run('INSERT OR IGNORE INTO settings (key, value) VALUES (?,?)', [k, v]));
}

// ─── resetDatabase: clear all data and re-seed ───────────────────────────────
// v0.8.7: async + full Tauri support. Old version only reset webDb ref in Tauri,
// leaving the actual native SQLite untouched (bug 5 from v0.8.6 feedback).
export async function resetDatabase(): Promise<void> {
  // Clear localStorage
  tryStorage(() => { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(STORAGE_KEY_TS); return null; }, null);

  if (IS_TAURI) {
    try {
      const d = await getTauriDb();
      await d.execute('DELETE FROM tasks');
      await d.execute('DELETE FROM tags');
      await d.execute('DELETE FROM statuses');
      await d.execute('DELETE FROM settings');
      try { await d.execute(`DELETE FROM sqlite_sequence WHERE name IN ('tasks','tags','statuses')`); } catch { /* may not exist */ }
      await tauriSeed();
    } catch (e) {
      console.error('resetDatabase (tauri) error:', e);
      throw e;
    }
  }

  // Always rebuild webDb (sync cache) from scratch
  if (SQL) {
    try {
      webDb = new SQL.Database();
      ensureSchema(webDb);
      migrate(webDb);
      if (IS_TAURI) {
        // Hydrate webDb from freshly seeded Tauri DB
        const d = await getTauriDb();
        const statuses: any[] = await d.select('SELECT * FROM statuses ORDER BY sort_order');
        const tags: any[] = await d.select('SELECT * FROM tags ORDER BY sort_order');
        const tasks: any[] = await d.select('SELECT * FROM tasks ORDER BY sort_order');
        const settings: any[] = await d.select('SELECT * FROM settings');
        for (const s of statuses) {
          webDb.run(
            `INSERT OR REPLACE INTO statuses (id,name,color,behavior,sort_order,is_seed,is_technical,hidden,default_collapsed) VALUES (?,?,?,?,?,?,?,?,?)`,
            [s.id, s.name, s.color, s.behavior, s.sort_order, s.is_seed, s.is_technical, s.hidden ?? 0, s.default_collapsed ?? 0]
          );
        }
        for (const t of tags) {
          webDb.run(`INSERT OR REPLACE INTO tags (id,name,color,sort_order) VALUES (?,?,?,?)`, [t.id, t.name, t.color, t.sort_order]);
        }
        for (const t of tasks) {
          webDb.run(
            `INSERT OR REPLACE INTO tasks (id,title,comment,tag_id,status_id,start_date,deadline,finish_date,created_at,updated_at,sort_order,archived) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
            [t.id, t.title, t.comment, t.tag_id, t.status_id, t.start_date, t.deadline, t.finish_date, t.created_at, t.updated_at, t.sort_order, t.archived]
          );
        }
        for (const s of settings) {
          webDb.run(`INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)`, [s.key, s.value]);
        }
      } else {
        seed(webDb);
        save();
      }
    } catch (e) {
      console.error('resetDatabase (webDb rebuild) error:', e);
    }
  }
}

// ─── v0.9.35-dev.6.9.0: clearUserData ────────────────────────────────────────
// Очищает ЛОКАЛЬНЫЕ пользовательские данные без re-seed'а. Используется для
// варианта «Загрузить облачные» при смене аккаунта: после очистки следующий
// sync подтянет данные нового аккаунта через pull.
//
// Что удаляется:
//   • tasks, tags, statuses, task_templates, overdue_events — все данные;
//   • workspaces, workspace_members, workspace_settings — пространства/членство
//     прошлого аккаунта (Bug #1, фикс #3): иначе они остаются фантомами в
//     сайдбаре после смены аккаунта. Пересоздаются reconcile + pull;
//   • sync_outbox — очередь пуша (иначе старые локальные строки утекут в облако);
//   • sync_last_pulled_* курсоры в settings — чтобы pull забрал всё заново.
//
// Что СОХРАНЯЕТСЯ (намеренно, это не данные аккаунта):
//   • client_id — идентификатор устройства;
//   • snapshot_registry_v1 — реестр снимков (снимки не трогаем!);
//   • bound_user_id — вызывающий сам решает, снять ли привязку (обычно да,
//     через snapshots.setBoundUserId(null), чтобы sync привязал к новому);
//   • UI-настройки (theme, lang, font_size, autocleanup_* и т.п.).
//
// ВАЖНО: НЕ вызывает seed(). Если облако пустое, база останется без
// seed-статусов — это ожидаемо для «загрузить облачные» (пользователь получит
// ровно то, что в облаке). initDb при следующем старте засеет, только если
// таблицы реально пусты И это не сценарий clearUserData (мы вызываем sync
// сразу после, до перезапуска).
export async function clearUserData(): Promise<void> {
  const execBoth = async (sql: string, params: any[] = []) => {
    if (IS_TAURI) {
      const d = await getTauriDb();
      try { await d.execute(sql, params); } catch (e) { console.warn('[clearUserData][tauri]', sql, e); }
    }
    if (webDb) {
      try { webDb.run(sql, params); } catch (e) { console.warn('[clearUserData][web]', sql, e); }
    }
  };

  // Порядок: сначала зависимые (overdue_events ссылается на tasks), потом
  // tasks, потом справочники. FK не жёсткие, но порядок делаем логичным.
  await execBoth('DELETE FROM task_hold_periods');
  await execBoth('DELETE FROM overdue_events');
  await execBoth('DELETE FROM tasks');
  await execBoth('DELETE FROM task_templates');
  await execBoth('DELETE FROM tags');
  await execBoth('DELETE FROM statuses');
  await execBoth('DELETE FROM sync_outbox');
  // Bug #1 (фикс #3): пространства и членство прошлого аккаунта тоже локальные
  // данные — иначе после «Стереть все данные» / смены аккаунта их строки
  // остаются в SQLite и всплывают «фантомами» в сайдбаре (второе «Мои задачи»,
  // чужие ws). reconcilePersonalWorkspace() пересоздаст personal-ws нового
  // аккаунта, а pull подтянет актуальный состав. Обёрнуто в try — таблицы
  // появляются только с миграции v11 (на очень старых базах их нет).
  try { await execBoth('DELETE FROM workspace_settings'); } catch { /* до v11 таблицы нет */ }
  try { await execBoth('DELETE FROM workspace_members'); } catch { /* до v11 таблицы нет */ }
  try { await execBoth('DELETE FROM workspaces'); } catch { /* до v11 таблицы нет */ }
  // AUTOINCREMENT счётчики — чтобы новые id начинались с 1 (чистая база).
  try { await execBoth(`DELETE FROM sqlite_sequence WHERE name IN ('tasks','tags','statuses','task_templates','overdue_events','task_hold_periods','workspaces','workspace_members','workspace_settings')`); } catch { /* may not exist */ }
  // Сбрасываем курсоры pull, чтобы забрать всё облако заново.
  await execBoth(`DELETE FROM settings WHERE key LIKE 'sync_last_pulled_%'`);
  // Сбрасываем указатели пространств прошлого аккаунта: иначе UI застревает на
  // ws_<чужой_uid> (данные нового аккаунта приходят под ws_<новый_uid>, экран
  // пуст). Сами ws-строки/членство удалены выше (фикс #3);
  // reconcilePersonalWorkspace() выставит корректные указатели заново.
  await execBoth(`DELETE FROM settings WHERE key IN ('current_workspace_id','personal_workspace_id')`);
  // Fix 1 (fix-round2): сбрасываем маркер welcome-задачи, чтобы новый аккаунт
  // (или «стереть всё») снова получил стартовую welcome-задачу ровно один раз.
  await execBoth(`DELETE FROM settings WHERE key='welcome_seeded'`);

  // Персистим web-кэш.
  if (!IS_TAURI) save();
}

// ─── v0.9.35-dev.6.10.3: ensureSeededIfEmpty ─────────────────────────────────
//
// Закрывает две связанные проблемы, всплывшие при «загрузить из облака»
// (clearUserData) на аккаунтах, чьи сид-статусы были созданы ДО миграции v9
// (то есть без uuid и потому НЕ попавшие в облако):
//
//   1. Пустой список статусов. После clearUserData база пуста, а pull из такого
//      облака приносит только задачи — статусов там нет. Задачи-сироты
//      откладываются (deferred, см. pull.ts DeferRowError), и пользователь видит
//      пустой экран без единой колонки. Раньше при рестарте initDb засеивал
//      заново и создавал ОДНУ welcome-задачу («одна стартовая задача») — но это
//      происходило слишком поздно и без нужных статусов.
//
//   2. Историческая дыра в облаке. Сид-статусы без uuid никогда не пушились,
//      поэтому на всех устройствах этого аккаунта их нет в облаке. Пересеивая
//      их ЗДЕСЬ (с uuid + enqueue в sync_outbox), мы отдаём их в облако при
//      ближайшем push — и будущие устройства получат нормальный набор статусов.
//
// Функция ИДЕМПОТЕНТНА: сеет только если статусов реально нет (COUNT=0).
// НЕ создаёт welcome-задачу (иначе на «пустом» аккаунте после каждого pull
// плодилась бы лишняя «стартовая задача» — это и есть баг №3). Работает и в
// web (webDb.run), и в Tauri (getTauriDb().execute), заполняя оба зеркала.
//
// F36 (ADR 0028): параметр `seedWsIdOverride`. В Tauri `db.run()` пишет в
// нативную SQLite fire-and-forget (без await), а эта функция читает
// `personal_workspace_id` из НАТИВНОЙ базы — то есть сразу после
// `reconcilePersonalWorkspace()` указателя там ещё может не быть, и сев
// уходил на placeholder `ws_local` (задача при этом создавалась уже под
// `ws_<uid>` → доска без колонок). Поэтому вызывающий, который знает userId,
// обязан передать канонический `ws_<uid>` явно, а не полагаться на состояние
// БД. Без параметра поведение прежнее (чтение указателя из settings).
//
// Возвращает true, если сев произошёл (статусов не было), иначе false.
export async function ensureSeededIfEmpty(seedWsIdOverride?: string): Promise<boolean> {
  // 1. Проверяем, есть ли уже статусы. Считаем по «главному» хранилищу:
  //    в Tauri — нативная БД, в web — webDb.
  let statusCount = 0;
  try {
    if (IS_TAURI) {
      const d = await getTauriDb();
      const rows: any[] = await d.select(`SELECT COUNT(*) AS cnt FROM statuses`);
      statusCount = Number(rows[0]?.cnt ?? 0);
    } else if (webDb) {
      const stmt = webDb.prepare(`SELECT COUNT(*) AS cnt FROM statuses`);
      if (stmt.step()) statusCount = Number((stmt.getAsObject() as any).cnt ?? 0);
      stmt.free();
    }
  } catch (e) {
    console.warn('[ensureSeededIfEmpty] count failed:', e);
    // Безопасный дефолт: если посчитать не удалось — НЕ сеем (лучше пустой
    // экран, чем риск задвоить статусы).
    return false;
  }
  if (statusCount > 0) return false; // Уже есть статусы — ничего не делаем.

  const now = new Date().toISOString();

  // Универсальный executor: пишем в оба зеркала, где они доступны.
  const execBoth = async (sql: string, params: any[] = []) => {
    if (IS_TAURI) {
      const d = await getTauriDb();
      try { await d.execute(sql, params); } catch (e) { console.warn('[ensureSeededIfEmpty][tauri]', e); }
    }
    if (webDb) {
      try { webDb.run(sql, params); } catch (e) { console.warn('[ensureSeededIfEmpty][web]', e); }
    }
  };

  // client_id (проставлен миграцией v5/v9). Читаем из доступного хранилища.
  let clientId: string | null = null;
  try {
    if (IS_TAURI) {
      const d = await getTauriDb();
      const rows: any[] = await d.select(`SELECT value FROM settings WHERE key='client_id'`);
      clientId = rows[0]?.value ?? null;
    } else if (webDb) {
      const stmt = webDb.prepare(`SELECT value FROM settings WHERE key='client_id' LIMIT 1`);
      if (stmt.step()) clientId = ((stmt.getAsObject() as any).value as string) ?? null;
      stmt.free();
    }
  } catch (e) { console.warn('[ensureSeededIfEmpty] read client_id:', e); }

  // Wave A: personal workspace id для штампа seed-строк (аналогично seed()).
  // F36: приоритет — явно переданный ws-id (см. комментарий у сигнатуры).
  let seedWsId: string = (seedWsIdOverride ?? '').trim() || 'ws_local';
  try {
    if (seedWsId !== 'ws_local') {
      // Явный ws-id получен — читать БД не нужно (и небезопасно: в Tauri
      // указатель мог ещё не долететь до нативного зеркала).
    } else if (IS_TAURI) {
      const d = await getTauriDb();
      const rows: any[] = await d.select(`SELECT value FROM settings WHERE key='personal_workspace_id'`);
      seedWsId = (String(rows[0]?.value ?? '').trim()) || 'ws_local';
    } else if (webDb) {
      const stmt = webDb.prepare(`SELECT value FROM settings WHERE key='personal_workspace_id' LIMIT 1`);
      if (stmt.step()) seedWsId = ((((stmt.getAsObject() as any).value as string) ?? '').trim()) || 'ws_local';
      stmt.free();
    }
  } catch (e) { console.warn('[ensureSeededIfEmpty] read personal_workspace_id:', e); }

  // Статусы. ВАЖНО: генерируем ОДИН uuid на статус и пишем его в оба зеркала,
  // чтобы web и Tauri ссылались на одинаковые uuid (иначе рассинхрон в sync).
  const statusUuids: string[] = [];
  for (let i = 0; i < SEED_STATUSES.length; i++) {
    const s = SEED_STATUSES[i];
    const uuid = uuidv7();
    statusUuids.push(uuid);
    await execBoth(
      `INSERT INTO statuses
         (uuid, name, color, behavior, sort_order, is_seed, is_technical,
          hidden, default_collapsed, updated_at, version, client_id, workspace_id)
       VALUES (?,?,?,?,?,1,?,?,?,?,1,?,?)`,
      [uuid, s.name, s.color, s.behavior, i, s.is_technical, s.hidden, s.default_collapsed, now, clientId, seedWsId]
    );
  }

  // Теги.
  const tagUuids: string[] = [];
  for (let i = 0; i < SEED_TAGS.length; i++) {
    const t = SEED_TAGS[i];
    const uuid = uuidv7();
    tagUuids.push(uuid);
    await execBoth(
      `INSERT INTO tags (uuid, name, color, sort_order, updated_at, version, client_id, workspace_id)
       VALUES (?,?,?,?,?,1,?,?)`,
      [uuid, t.name, t.color, i, now, clientId, seedWsId]
    );
  }

  // Enqueue в sync_outbox — чтобы засеянные статусы/теги ушли в облако при
  // ближайшем push (закрывает историческую дыру: раньше их там не было).
  for (const uuid of statusUuids) {
    await execBoth(
      `INSERT OR IGNORE INTO sync_outbox (entity_table, entity_uuid, op, queued_at, attempt_count)
       VALUES ('statuses', ?, 'upsert', datetime('now'), 0)`,
      [uuid]
    );
  }
  for (const uuid of tagUuids) {
    await execBoth(
      `INSERT OR IGNORE INTO sync_outbox (entity_table, entity_uuid, op, queued_at, attempt_count)
       VALUES ('tags', ?, 'upsert', datetime('now'), 0)`,
      [uuid]
    );
  }

  // Персистим web-кэш.
  if (!IS_TAURI) save();

  console.info(`[ensureSeededIfEmpty] seeded ${statusUuids.length} statuses + ${tagUuids.length} tags (no welcome task)`);
  return true;
}

// ─── F19 (ADR 0013): dedupeSeedStatuses — схлопывание дублей сид-статусов ────
//
// ПЕРВОПРИЧИНА дублей «Важно/В работе/…» в «Моих задачах»:
// идентичность сид-справочника НЕ детерминирована. tauriSeed(), seed(),
// ensureSeededIfEmpty() и store.seedDefaultStatuses() генерируют СВЕЖИЙ uuidv7()
// на каждый запуск, а единственный ключ дедупа на стороне pull
// (applyCloudRowStatuses) — это uuid. Все локальные guard'ы («сеем, только если
// COUNT(*)=0») смотрят в ЛОКАЛЬНУЮ базу и не видят, что семантически тот же
// набор уже лежит в облаке. Поэтому любое ВТОРОЕ поколение сида для того же
// аккаунта — переустановка, второе устройство, clearUserData() + бутстрап
// free-плана, resetDatabase() — уезжает в облако рядом с первым, и ближайший
// pull приносит чужое поколение обратно: 14 статусов вместо 7.
//
// Тот же класс, что F17/ADR 0011 (workspace_members: логическая идентичность —
// не uuid, а натуральный ключ). Для сид-статусов натуральный ключ —
// (workspace_id, name) при is_seed=1.
//
// ЛЕЧЕНИЕ (локальное, без DDL и без изменений на сервере): в каждой группе
// (workspace_id, name) оставляем строку с ЛЕКСИКОГРАФИЧЕСКИ МЕНЬШИМ uuid.
// uuidv7 монотонен по времени, поэтому «меньший» = «более раннее поколение» —
// и все устройства независимо приходят к ОДНОМУ И ТОМУ ЖЕ победителю
// (конвергенция без координации). Проигравшие строки:
//   * освобождаются от ссылок (tasks.status_id / task_templates.status_id
//     переезжают на победителя);
//   * гасятся soft-delete'ом ЛОКАЛЬНО, БЕЗ enqueueOutbox — по образцу
//     dedupePersonalWorkspaces(): мы не знаем, не является ли это поколение
//     живым для другого устройства, и не имеем права удалять его в облаке;
//   * получают свежий updated_at, иначе следующий pull по LWW воскресит их.
//
// Облачные задачи, ссылающиеся на погашенное поколение, остаются разрешимыми:
// resolveStatusIdByUuid() (sync/mappers.ts) умеет доехать от tombstone'а
// сид-статуса до его выжившего близнеца по (workspace_id, name).
//
// Строго ИДЕМПОТЕНТНА: работает только по `is_seed=1 AND deleted_at IS NULL`,
// группы из одной строки не трогает. Возвращает число погашенных строк.
export async function dedupeSeedStatuses(): Promise<number> {
  const selectAll = async (sql: string): Promise<any[]> => {
    if (IS_TAURI) {
      const d = await getTauriDb();
      return await d.select(sql);
    }
    if (!webDb) return [];
    const stmt = webDb.prepare(sql);
    const out: any[] = [];
    while (stmt.step()) out.push(stmt.getAsObject());
    stmt.free();
    return out;
  };
  const execBoth = async (sql: string, params: any[] = []) => {
    if (IS_TAURI) {
      const d = await getTauriDb();
      await d.execute(sql, params);
    }
    if (webDb) webDb.run(sql, params);
  };

  let rows: any[];
  try {
    rows = await selectAll(
      `SELECT id, uuid, name, workspace_id FROM statuses
        WHERE is_seed=1 AND deleted_at IS NULL ORDER BY id`,
    );
  } catch (e) {
    console.warn('[dedupeSeedStatuses] read failed:', e);
    return 0;
  }

  const groups = new Map<string, any[]>();
  for (const r of rows) {
    const key = `${r.workspace_id ?? ''} ${r.name}`;
    const g = groups.get(key);
    if (g) g.push(r); else groups.set(key, [r]);
  }

  const now = new Date().toISOString();
  let removed = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    // Порядок: сначала строки с uuid (по возрастанию), затем безuuid'ные (их
    // всё равно нельзя синхронизировать), в конце — по id для полной
    // детерминированности.
    const sorted = [...group].sort((a, b) => {
      const au = a.uuid ?? null, bu = b.uuid ?? null;
      if (au !== bu) {
        if (au == null) return 1;
        if (bu == null) return -1;
        return au < bu ? -1 : 1;
      }
      return a.id - b.id;
    });
    const keeper = sorted[0];
    for (const loser of sorted.slice(1)) {
      try {
        await execBoth('UPDATE tasks SET status_id=? WHERE status_id=?', [keeper.id, loser.id]);
        await execBoth('UPDATE task_templates SET status_id=? WHERE status_id=?', [keeper.id, loser.id]);
        await execBoth(
          'UPDATE statuses SET deleted_at=?, updated_at=? WHERE id=? AND deleted_at IS NULL',
          [now, now, loser.id],
        );
        removed++;
      } catch (e) {
        console.warn('[dedupeSeedStatuses] collapse failed:', e);
      }
    }
  }

  if (removed > 0) {
    if (!IS_TAURI) save();
    console.info(`[dedupeSeedStatuses] погашено дублей сид-статусов: ${removed}`);
  }
  return removed;
}

// ─── Fix 1 (fix-round2): ensureWelcomeTaskIfNeeded ───────────────────────────
//
// Гарантирует стартовую welcome-задачу для локального personal-пространства.
// В отличие от seed() (полный первичный сев на свежей установке) и
// ensureSeededIfEmpty (досев справочника без welcome), эта функция создаёт
// РОВНО ОДНУ welcome-задачу и только когда её ещё не создавали.
//
// Нужна прежде всего free-плану: orchestrator вызывает её на free-ветке (сеть
// paywalled), чтобы пользователь без Pro всё равно получил рабочее локальное
// пространство с приветственной задачей — полностью офлайн.
//
// Идемпотентность — через маркер settings.welcome_seeded:
//   • маркер стоит                 → no-op (уже создавали);
//   • маркера нет, но задачи есть   → ставим маркер, welcome НЕ плодим
//                                     (fresh seed уже создал welcome, либо у
//                                      пользователя своя работа);
//   • маркера нет и задач нет       → создаём welcome + enqueue outbox + маркер.
// clearUserData() удаляет маркер, поэтому новый аккаунт снова получит welcome.
//
// F36 (ADR 0028): параметр `seedWsIdOverride` — та же гарантия, что и у
// ensureSeededIfEmpty(): ws-id берётся из аргумента, а не из нативного зеркала
// settings (которое в Tauri обновляется fire-and-forget). Дополнительно статус
// для welcome-задачи выбирается СТРОГО внутри целевого пространства — иначе
// задача могла бы сослаться на статус чужого ws и стать невидимой на доске.
//
// Возвращает true, если welcome-задача была создана, иначе false.
export async function ensureWelcomeTaskIfNeeded(_userId?: string, seedWsIdOverride?: string): Promise<boolean> {
  const readScalar = async (sql: string, col: string): Promise<any> => {
    try {
      if (IS_TAURI) {
        const d = await getTauriDb();
        const rows: any[] = await d.select(sql);
        return rows[0]?.[col];
      } else if (webDb) {
        const stmt = webDb.prepare(sql);
        let out: any = undefined;
        if (stmt.step()) out = (stmt.getAsObject() as any)[col];
        stmt.free();
        return out;
      }
    } catch (e) { console.warn('[ensureWelcomeTaskIfNeeded] read failed:', e); }
    return undefined;
  };

  const execBoth = async (sql: string, params: any[] = []) => {
    if (IS_TAURI) {
      const d = await getTauriDb();
      try { await d.execute(sql, params); } catch (e) { console.warn('[ensureWelcomeTaskIfNeeded][tauri]', e); }
    }
    if (webDb) {
      try { webDb.run(sql, params); } catch (e) { console.warn('[ensureWelcomeTaskIfNeeded][web]', e); }
    }
  };

  const marker = await readScalar(`SELECT value FROM settings WHERE key='welcome_seeded' LIMIT 1`, 'value');
  if (marker) return false;

  const taskCount = Number(await readScalar(`SELECT COUNT(*) AS cnt FROM tasks`, 'cnt') ?? 0);
  if (taskCount > 0) {
    // Задачи уже есть — welcome не дублируем, лишь фиксируем маркер.
    await execBoth(`INSERT OR REPLACE INTO settings (key, value) VALUES ('welcome_seeded','1')`);
    if (!IS_TAURI) save();
    return false;
  }

  const tagId = (await readScalar(`SELECT id FROM tags WHERE name='PRS' LIMIT 1`, 'id')) ?? null;
  const clientId = (await readScalar(`SELECT value FROM settings WHERE key='client_id' LIMIT 1`, 'value')) ?? null;
  // F36: сначала явный ws-id из аргумента, только потом указатель из settings.
  const seedWsId =
    ((seedWsIdOverride ?? '').trim())
    || (String((await readScalar(`SELECT value FROM settings WHERE key='personal_workspace_id' LIMIT 1`, 'value')) ?? '').trim())
    || 'ws_local';

  // Статус обязателен (tasks.status_id NOT NULL). Предпочитаем «Сегодня» (как в
  // seed()), иначе — первый по порядку. F36: ищем ТОЛЬКО среди статусов целевого
  // пространства — задача со статусом чужого ws не рендерится на доске.
  const wsLit = seedWsId.replace(/'/g, "''");
  let statusId = await readScalar(
    `SELECT id FROM statuses WHERE name='Сегодня' AND workspace_id='${wsLit}' AND deleted_at IS NULL LIMIT 1`, 'id');
  if (statusId == null) {
    statusId = await readScalar(
      `SELECT id FROM statuses WHERE workspace_id='${wsLit}' AND deleted_at IS NULL ORDER BY sort_order, id LIMIT 1`, 'id');
  }
  if (statusId == null) {
    console.warn(`[ensureWelcomeTaskIfNeeded] no statuses in ${seedWsId}, skipping welcome`);
    return false;
  }

  const now = new Date().toISOString();
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const deadlineDate = new Date(today);
  deadlineDate.setDate(deadlineDate.getDate() + 3);
  const deadlineStr = `${deadlineDate.getFullYear()}-${String(deadlineDate.getMonth() + 1).padStart(2, '0')}-${String(deadlineDate.getDate()).padStart(2, '0')}`;

  const taskUuid = uuidv7();
  await execBoth(
    `INSERT INTO tasks
       (uuid, title, comment, tag_id, status_id, start_date, deadline, finish_date,
        created_at, updated_at, sort_order, archived, version, client_id, workspace_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,0,1,?,?)`,
    [
      taskUuid,
      'Добро пожаловать в TaskFlow',
      'Нажмите ✓ справа, чтобы выполнить задачу, или иконка корзины 🗑 в правом верхнем углу — чтобы удалить.',
      tagId, statusId, todayStr, deadlineStr, null, now, now, 0, clientId, seedWsId,
    ]
  );
  await execBoth(
    `INSERT OR IGNORE INTO sync_outbox (entity_table, entity_uuid, op, queued_at, attempt_count)
     VALUES ('tasks', ?, 'upsert', datetime('now'), 0)`,
    [taskUuid]
  );
  await execBoth(`INSERT OR REPLACE INTO settings (key, value) VALUES ('welcome_seeded','1')`);
  if (!IS_TAURI) save();

  console.info('[ensureWelcomeTaskIfNeeded] welcome task created');
  return true;
}

// ─── F16: авто-обнаружение и восстановление битой локальной SQLite ──────────
// (ADR 0010, roadmap §7.16). Root cause: у части пользователей локальная
// SQLite физически повреждается («database disk image is malformed», code 11)
// или её индексы расходятся с данными (code 2067 UNIQUE constraint failed на
// уже отсутствующих строках). Applier тогда не находит строку по SELECT
// uuid=?, уходит в ветку INSERT, а unique-индекс всё равно её видит — падение.
// Снаружи это выглядит как «pull возвращает 200, но ничего не применяется»,
// а после рестарта prunePhantomWorkspaces подчищает ws без локального
// membership — сайдбар пустеет. Детект — PRAGMA integrity_check при каждом
// старте, ДО ensureSchema/migrate/hydrate, чтобы не работать поверх мусора.
export interface CorruptionCheckResult {
  recovered: boolean;
  reason?: string;
}

/**
 * Список локальных таблиц, которые нужно попытаться сбросить в Tauri-ветке,
 * если native SQLite повреждена сильнее, чем можно починить точечно. Список
 * синхронизирован с ensureSchema()/migrations.ts (все таблицы, которые
 * когда-либо создавались локально).
 */
const KNOWN_TABLES = [
  'statuses',
  'tags',
  'tasks',
  'settings',
  'task_templates',
  'overdue_events',
  'task_hold_periods',
  'sync_outbox',
  'workspaces',
  'workspace_members',
  'workspace_settings',
  'task_activity_log',
];

function isCorruptionError(e: unknown): boolean {
  const msg = String((e as any)?.message ?? e ?? '');
  return (
    /database disk image is malformed/i.test(msg) ||
    /code:?\s*11\b/i.test(msg) ||
    /SQLITE_CORRUPT/i.test(msg)
  );
}

/**
 * Обнаруживает битую локальную SQLite при старте и восстанавливает базу
 * (сбрасывает локальное хранилище — облако остаётся источником истины для
 * Pro-плана, следующий syncNow подтянет всё заново).
 *
 * Вызывается в самом начале initDb(), ДО ensureSchema/migrate/hydrate.
 */
export async function detectAndRecoverCorruption(): Promise<CorruptionCheckResult> {
  if (!IS_TAURI) {
    // ── Web-ветка: sql.js + localStorage ──────────────────────────────────
    const raw = tryStorage(() => localStorage.getItem(STORAGE_KEY), null);
    if (!raw) return { recovered: false };

    let reason: string | null = null;
    try {
      let bytes: Uint8Array;
      try {
        const arr = JSON.parse(raw) as number[];
        bytes = new Uint8Array(arr);
      } catch (e) {
        reason = `invalid stored payload (JSON.parse failed): ${String((e as any)?.message ?? e)}`;
        bytes = new Uint8Array();
      }

      if (!reason) {
        if (!SQL) {
          SQL = await initSqlJs({ locateFile: () => wasmUrl as string });
        }
        let probe: Database | null = null;
        try {
          probe = new SQL.Database(bytes);
        } catch (e) {
          reason = `invalid SQLite header (constructor threw): ${String((e as any)?.message ?? e)}`;
        }
        if (probe && !reason) {
          try {
            const res = probe.exec("PRAGMA integrity_check");
            const value = res?.[0]?.values?.[0]?.[0];
            if (String(value ?? '').toLowerCase() !== 'ok') {
              reason = `PRAGMA integrity_check returned: ${String(value)}`;
            }
          } catch (e) {
            if (isCorruptionError(e)) {
              reason = `integrity_check threw SQLITE_CORRUPT: ${String((e as any)?.message ?? e)}`;
            } else {
              reason = `integrity_check threw: ${String((e as any)?.message ?? e)}`;
            }
          }

          // F16 escalation: integrity_check иногда возвращает 'ok', пока порча
          // ограничена рассинхроном одного uuid-индекса с таблицей. integrity_check
          // это не всегда ловит. Пробуем вставить/удалить строку в ИЗОЛИРОВАННУЮ
          // временную таблицу с UNIQUE-индексом — любое исключение на такой
          // тривиальной операции указывает на физический рассинхрон индекса с
          // данными, т.е. настоящую corruption.
          //
          // F17 (ADR 0011): этот probe НЕ связан с UNIQUE-коллизией 2067 на
          // workspace_members(workspace_id, user_id). Та коллизия — штатный
          // рассинхрон локального uuid с серверным при accept-invite и чинится
          // fallback-матчером в pull.ts::applyCloudRowMembers, а не сбросом БД.
          // Здесь probe работает на СВОЕЙ таблице __corruption_probe и ловит
          // только реальную порчу движка/страниц, независимую от бизнес-данных.
          if (!reason) {
            try {
              probe.exec("CREATE TEMP TABLE IF NOT EXISTS __corruption_probe (id INTEGER PRIMARY KEY, k TEXT UNIQUE)");
              probe.exec("INSERT INTO __corruption_probe (k) VALUES ('probe_' || abs(random()))");
              probe.exec("DROP TABLE __corruption_probe");
            } catch (e) {
              reason = `unique-probe failed: ${String((e as any)?.message ?? e)}`;
            }
          }

          try { probe.close(); } catch { /* noop */ }
        }
      }
    } catch (e) {
      reason = `unexpected error probing local SQLite: ${String((e as any)?.message ?? e)}`;
    }

    if (reason) {
      console.error('[db][corruption] detected, will reset:', reason);
      tryStorage(() => { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(STORAGE_KEY_TS); return null; }, null);
      return { recovered: true, reason };
    }
    return { recovered: false };
  }

  // ── Tauri-ветка: native SQLite через @tauri-apps/plugin-sql ──────────────
  let reason: string | null = null;
  let d: any = null;
  try {
    d = await getTauriDb();
  } catch (e) {
    reason = `getTauriDb() failed: ${String((e as any)?.message ?? e)}`;
  }

  if (d && !reason) {
    try {
      const rows: any[] = await d.select('PRAGMA integrity_check');
      const value = rows?.[0]?.integrity_check ?? Object.values(rows?.[0] ?? {})[0];
      if (String(value ?? '').toLowerCase() !== 'ok') {
        reason = `PRAGMA integrity_check returned: ${String(value)}`;
      }
    } catch (e) {
      if (isCorruptionError(e)) {
        reason = `integrity_check threw SQLITE_CORRUPT: ${String((e as any)?.message ?? e)}`;
      } else {
        reason = `integrity_check threw: ${String((e as any)?.message ?? e)}`;
      }
    }
  }

  if (!reason) return { recovered: false };

  console.error('[db][corruption] detected, will reset:', reason);
  let dropFailed = false;
  try {
    const dd = d ?? (await getTauriDb());
    for (const table of KNOWN_TABLES) {
      try {
        await dd.execute(`DROP TABLE IF EXISTS ${table}`);
      } catch (e) {
        dropFailed = true;
        console.error(`[db][corruption] failed to drop table ${table}:`, e);
      }
    }
    tauriDb = null; // форсируем переоткрытие соединения на следующем getTauriDb()
  } catch (e) {
    dropFailed = true;
    console.error('[db][corruption] failed to reset Tauri DB:', e);
  }

  if (dropFailed && typeof window !== 'undefined') {
    // БД не поддаётся восстановлению точечными DROP — просим пользователя
    // переустановить. Отдельный флаг (не тот же, что recovered), чтобы
    // компонент App показал другой (более настойчивый) toast при необходимости.
    (window as any).__taskflow_corruption_unrecoverable = true;
  }

  if (typeof window !== 'undefined') (window as any).__taskflow_corruption_recovered = reason;
  return { recovered: true, reason };
}

// ─── PUBLIC init ──────────────────────────────────────────────────────────────
/**
 * Идёт ли прямо сейчас инициализация. F19 (ADR 0013): в Tauri-ветке initDb()
 * НЕ была реентерабельной (в web-ветке защита есть — `if (webDb) return`). Два
 * параллельных вызова на чистой базе успевали пройти `tauriIsEmpty()` до того,
 * как соседний вызов дописал сид → сид выполнялся дважды. Теперь конкурентные
 * вызовы разделяют один промис; последовательные (рестарт, тесты) — как раньше.
 */
let initDbInFlight: Promise<void> | null = null;

export function initDb(): Promise<void> {
  if (initDbInFlight) return initDbInFlight;
  const p = initDbOnce().finally(() => {
    if (initDbInFlight === p) initDbInFlight = null;
  });
  initDbInFlight = p;
  return p;
}

async function initDbOnce(): Promise<void> {
  // Always initialise the in-memory sql.js database as a synchronous cache layer.
  // In Tauri mode we additionally set up the native SQLite and sync data into webDb.
  if (!SQL) {
    SQL = await initSqlJs({ locateFile: () => wasmUrl as string });
  }

  // F16 (ADR 0010, roadmap §7.16): проверяем целостность локальной SQLite ДО
  // ensureSchema/migrate/hydrate — иначе миграции/сид работают поверх битой
  // базы и просто маскируют проблему до следующего рестарта.
  const corruption = await detectAndRecoverCorruption();
  if (corruption.recovered) {
    if (typeof window !== 'undefined') {
      (window as any).__taskflow_corruption_recovered = corruption.reason ?? 'sqlite_corruption';
    }
    // Локальное хранилище уже сброшено внутри detectAndRecoverCorruption(),
    // поэтому bound_user_id (живёт в settings — самой таблице, которую мы
    // только что стёрли/пересоздадим) автоматически потеряется вместе с ней.
    // Следующий успешный syncNow() привяжет базу к аккаунту заново.
    // Дополнительно снимаем возможный webDb-кэш в памяти (веб-ветка) — иначе
    // ниже `if (webDb) return;` вернёт управление раньше, чем мы пересоздадим
    // базу из чистого localStorage.
    webDb = null;
  }

  if (IS_TAURI) {
    // Set up native SQLite
    await tauriEnsureSchema();
    // ВАЖНО: мигрируем ДО seed, иначе для старых БД INSERT из seed падает
    // на отсутствующих колонках (hidden / default_collapsed / is_technical).
    await tauriMigrate();
    // v0.8.12: явные миграции через PRAGMA user_version. Существующая БД
    // (схема v0.8.11) помечается как v1; будущие изменения схемы будут
    // регистрироваться в src/lib/migrations.ts как v2, v3, ...
    try {
      const d = await getTauriDb();
      await runMigrations(tauriMigrationApi(d), { onLog: (m) => console.log(m) });
    } catch (e) {
      console.error('[migrate][tauri]', e);
      if (typeof window !== 'undefined') (window as any).__taskflow_init_error = String((e as any)?.message ?? e);
    }
    const empty = await tauriIsEmpty();
    if (empty) await tauriSeed();

    // Pull data from Tauri DB into webDb (in-memory) so sync calls work
    const d = await getTauriDb();
    // v0.9.35-dev.1: SELECT * во всех таблицах возвращает sync-колонки,
    // которые мы добавили миграцией v5. Копируем всё в webDb — она должна
    // работать как полное зеркало Tauri-DB.
    const statuses: any[] = await d.select('SELECT * FROM statuses ORDER BY sort_order');
    const tags: any[] = await d.select('SELECT * FROM tags ORDER BY sort_order');
    const tasks: any[] = await d.select('SELECT * FROM tasks ORDER BY sort_order');
    const settings: any[] = await d.select('SELECT * FROM settings');
    // v0.8.13/14: task_templates — таблица появляется после миграции v2.
    // Из безопасности — try/catch на случай, если миграция раньше упала.
    let templates: any[] = [];
    try { templates = await d.select('SELECT * FROM task_templates ORDER BY sort_order, id'); }
    catch (e) { console.warn('[initDb] task_templates not available yet:', e); }
    // v0.9.2: overdue_events появляется после миграции v4. Аналогично защищаемся.
    let overdueEvents: any[] = [];
    try { overdueEvents = await d.select('SELECT * FROM overdue_events'); }
    catch (e) { console.warn('[initDb] overdue_events not available yet:', e); }
    // v0.9.35: task_hold_periods появляется после миграции v10. Защищаемся.
    let holdPeriods: any[] = [];
    try { holdPeriods = await d.select('SELECT * FROM task_hold_periods'); }
    catch (e) { console.warn('[initDb] task_hold_periods not available yet:', e); }
    // F18 (ADR 0012): workspaces / workspace_members появляются после миграции
    // v11. РАНЬШЕ эти таблицы НЕ гидрировались в webDb-зеркало — при рестарте
    // зеркало стартовало ПУСТЫМ по членству, applyCloudRowMembers не находил
    // существующую (native) строку → INSERT → 2067 в нативной data.db →
    // prunePhantomWorkspaces сносил shared-ws → пустой сайдбар. Это истинный
    // корень «shared пропадают после рестарта» (F14–F17 чинили симптом).
    // Правило §11.3 арх-дока: любая ws-scoped таблица ОБЯЗАНА гидрироваться.
    let workspaces: any[] = [];
    try { workspaces = await d.select('SELECT * FROM workspaces ORDER BY sort_order, id'); }
    catch (e) { console.warn('[initDb] workspaces not available yet:', e); }
    let members: any[] = [];
    try { members = await d.select('SELECT * FROM workspace_members ORDER BY id'); }
    catch (e) { console.warn('[initDb] workspace_members not available yet:', e); }
    // F19 (ADR 0013): workspace_settings + task_activity_log — тот же класс,
    // что F18. workspace_settings читается стором (overdue_mode текущего ws) и
    // матчится пуллом по (workspace_id, key): пустое зеркало → INSERT → 2067 в
    // нативной БД (fire-and-forget глотает ошибку) → режим просрочки на рестарте
    // молча откатывался к глобальному. task_activity_log — источник вкладки
    // «История»: без гидрации журнал исчезал из UI до следующего pull.
    let wsSettings: any[] = [];
    try { wsSettings = await d.select('SELECT * FROM workspace_settings ORDER BY id'); }
    catch (e) { console.warn('[initDb] workspace_settings not available yet:', e); }
    let activityLog: any[] = [];
    try { activityLog = await d.select('SELECT * FROM task_activity_log ORDER BY id'); }
    catch (e) { console.warn('[initDb] task_activity_log not available yet:', e); }

    webDb = new SQL!.Database();
    ensureSchema(webDb);
    migrate(webDb);
    // v0.9.35-dev.1: накатываем PRAGMA-миграции (v2–v5) также для webDb
    // в Tauri-режиме. Схема должна быть готова принять sync-колонки
    // до hydrate. Сам backfill uuid'ов внутри v5 отработает вхолостую
    // (webDb пуст, строк в SELECT WHERE uuid IS NULL нет) — hydrate
    // сам зальёт правильные uuid из Tauri.
    try {
      await runMigrations(webMigrationApi(webDb), { onLog: (m) => console.log(m) });
    } catch (e) {
      console.error('[migrate][webDb-cache]', e);
    }

    // v0.9.35-dev.1: helper — берём sync-колонки из строки Tauri;
    // если в старой базе их нет — подставляем NULL/1 (безопасные дефолты).
    const syncCols = (r: any) => [
      r.uuid ?? null,
      r.deleted_at ?? null,
      r.version ?? 1,
      r.client_id ?? null,
    ];

    // Populate webDb from Tauri data.
    // Wave A (workspaces): гидрация ОБЯЗАНА переносить workspace_id — иначе
    // сид-строки (и любые ws-scoped данные) читаются стором как workspace_id=NULL
    // и выпадают из выборок текущего пространства (регрессия P1).
    for (const s of statuses) {
      webDb.run(
        `INSERT OR REPLACE INTO statuses (id,name,color,behavior,sort_order,is_seed,is_technical,hidden,default_collapsed,updated_at,uuid,deleted_at,version,client_id,workspace_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [s.id, s.name, s.color, s.behavior, s.sort_order, s.is_seed, s.is_technical, s.hidden ?? 0, s.default_collapsed ?? 0, s.updated_at ?? new Date().toISOString(), ...syncCols(s), s.workspace_id ?? null]
      );
    }
    for (const t of tags) {
      webDb.run(
        `INSERT OR REPLACE INTO tags (id,name,color,sort_order,updated_at,uuid,deleted_at,version,client_id,workspace_id) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [t.id, t.name, t.color, t.sort_order, t.updated_at ?? new Date().toISOString(), ...syncCols(t), t.workspace_id ?? null]
      );
    }
    for (const t of tasks) {
      webDb.run(
        `INSERT OR REPLACE INTO tasks (id,title,comment,tag_id,status_id,start_date,deadline,finish_date,created_at,updated_at,sort_order,archived,uuid,deleted_at,version,client_id,workspace_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [t.id, t.title, t.comment, t.tag_id, t.status_id, t.start_date, t.deadline, t.finish_date, t.created_at, t.updated_at, t.sort_order, t.archived, ...syncCols(t), t.workspace_id ?? null]
      );
    }
    for (const s of settings) {
      webDb.run(`INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)`, [s.key, s.value]);
    }
    for (const t of templates) {
      webDb.run(
        `INSERT OR REPLACE INTO task_templates (id,name,title,comment,status_id,tag_id,sort_order,created_at,updated_at,uuid,deleted_at,version,client_id,workspace_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [t.id, t.name, t.title, t.comment, t.status_id, t.tag_id, t.sort_order, t.created_at, t.updated_at, ...syncCols(t), t.workspace_id ?? null]
      );
    }
    for (const e of overdueEvents) {
      webDb.run(
        `INSERT OR REPLACE INTO overdue_events (id, task_id, deadline_snapshot, event_date, created_at, updated_at, uuid, deleted_at, version, client_id, workspace_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [e.id, e.task_id, e.deadline_snapshot, e.event_date, e.created_at, e.updated_at ?? e.created_at, ...syncCols(e), e.workspace_id ?? null]
      );
    }
    for (const h of holdPeriods) {
      webDb.run(
        `INSERT OR REPLACE INTO task_hold_periods (id, task_id, started_at, ended_at, created_at, updated_at, uuid, deleted_at, version, client_id, workspace_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [h.id, h.task_id, h.started_at, h.ended_at ?? null, h.created_at, h.updated_at ?? h.created_at, ...syncCols(h), h.workspace_id ?? null]
      );
    }
    // F18 (ADR 0012): гидрация workspaces + workspace_members в зеркало.
    // Без неё applyCloudRowMembers на рестарте видит пустую таблицу → INSERT →
    // 2067 в нативной БД. INSERT OR REPLACE по PK id безопасен (webDb пуст).
    for (const w of workspaces) {
      webDb.run(
        `INSERT OR REPLACE INTO workspaces (id, uuid, name, kind, owner_id, sort_order, created_at, updated_at, deleted_at, version, client_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [w.id, w.uuid ?? null, w.name, w.kind ?? 'personal', w.owner_id ?? null, w.sort_order ?? 0, w.created_at, w.updated_at ?? w.created_at, w.deleted_at ?? null, w.version ?? 1, w.client_id ?? null]
      );
    }
    for (const m of members) {
      webDb.run(
        `INSERT OR REPLACE INTO workspace_members (id, uuid, workspace_id, user_id, role, invited_by, joined_at, created_at, updated_at, deleted_at, version, client_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [m.id, m.uuid ?? null, m.workspace_id, m.user_id ?? null, m.role ?? 'owner', m.invited_by ?? null, m.joined_at ?? m.created_at, m.created_at, m.updated_at ?? m.created_at, m.deleted_at ?? null, m.version ?? 1, m.client_id ?? null]
      );
    }
    // F19 (ADR 0013): см. комментарий у SELECT выше.
    for (const s of wsSettings) {
      webDb.run(
        `INSERT OR REPLACE INTO workspace_settings (id, uuid, workspace_id, key, value, created_at, updated_at, deleted_at, version, client_id) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [s.id, s.uuid ?? null, s.workspace_id, s.key, s.value ?? null, s.created_at, s.updated_at ?? s.created_at, s.deleted_at ?? null, s.version ?? 1, s.client_id ?? null]
      );
    }
    for (const a of activityLog) {
      webDb.run(
        `INSERT OR REPLACE INTO task_activity_log (id, uuid, task_id, workspace_id, user_id, kind, payload, created_at) VALUES (?,?,?,?,?,?,?,?)`,
        [a.id, a.uuid ?? null, a.task_id, a.workspace_id, a.user_id, a.kind, a.payload ?? '{}', a.created_at]
      );
    }

    // F19 (ADR 0013): самолечение дублей сид-статусов, приехавших из облака
    // прошлыми запусками. Идемпотентно; на здоровой базе — no-op.
    try { await dedupeSeedStatuses(); } catch (e) { console.warn('[initDb] dedupeSeedStatuses:', e); }
  } else {
    if (webDb) return;
    const stored = loadFromStorage();
    webDb = stored ? new SQL.Database(stored) : new SQL.Database();
    ensureSchema(webDb);
    migrate(webDb); // migrate BEFORE seed — по тем же причинам, что и в Tauri-ветке
    // v0.8.12: явные миграции через PRAGMA user_version.
    try {
      await runMigrations(webMigrationApi(webDb), { onLog: (m) => console.log(m) });
    } catch (e) {
      console.error('[migrate][web]', e);
      if (typeof window !== 'undefined') (window as any).__taskflow_init_error = String((e as any)?.message ?? e);
    }
    if (!stored) seed(webDb);
    try { await dedupeSeedStatuses(); } catch (e) { console.warn('[initDb] dedupeSeedStatuses:', e); }
    save();
  }
}

/**
 * v0.8.12: returns the current schema version (PRAGMA user_version) for display
 * in Settings → Storage → Diagnostics. Falls back to 0 if unavailable.
 */
export async function getSchemaVersion(): Promise<number> {
  try {
    if (IS_TAURI) {
      const d = await getTauriDb();
      const rows: any[] = await d.select(`PRAGMA user_version`);
      return Number(rows[0]?.user_version ?? 0);
    }
    if (!webDb) return 0;
    const stmt = webDb.prepare(`PRAGMA user_version`);
    stmt.step();
    const row: any = stmt.getAsObject();
    stmt.free();
    return Number(row?.user_version ?? 0);
  } catch { return 0; }
}

// ─── PUBLIC query helpers ─────────────────────────────────────────────────────
export function all<T = any>(sql: string, params: any[] = []): T[] {
  if (IS_TAURI) {
    // Tauri mode: return empty synchronously — callers in the store use refresh()
    // which is called after await initDb(). For synchronous callers we return [].
    // The store's init() awaits initDb() so after that all sync calls work via webDb fallback.
    // NOTE: In full Tauri mode, the store would need async versions.
    // As a pragmatic solution for v0.8, sync calls remain web-only; Tauri uses the same sync
    // pattern via the webDb that gets populated on first init.
    // TODO: In a future version, make store fully async for Tauri.
    if (!webDb) return [];
    const stmt = webDb.prepare(sql);
    stmt.bind(params);
    const rows: T[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject() as T);
    stmt.free();
    return rows;
  }
  if (!webDb) throw new Error('DB not initialized');
  const stmt = webDb.prepare(sql);
  stmt.bind(params);
  const rows: T[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject() as T);
  stmt.free();
  return rows;
}

export function get<T = any>(sql: string, params: any[] = []): T | null {
  const r = all<T>(sql, params);
  return r[0] ?? null;
}

export function run(sql: string, params: any[] = []): { changes: number; lastInsertRowid: number } {
  if (IS_TAURI) {
    // Sync run in Tauri mode: use webDb as cache layer, then fire-and-forget to Tauri DB.
    // This keeps the store synchronous.
    if (webDb) {
      webDb.run(sql, params);
      const rs = webDb.exec('SELECT changes() AS c, last_insert_rowid() AS i')[0];
      const c = (rs?.values[0]?.[0] as number) ?? 0;
      const i = (rs?.values[0]?.[1] as number) ?? 0;
      // F37 (ADR 0029): запись в нативную SQLite по-прежнему НЕ блокирует
      // синхронный run(), но ставится в ОДНУ последовательную очередь, а не
      // «в полёт» независимыми промисами. Две причины:
      //   1) порядок. Раньше `getTauriDb().then(d => d.execute(...))` для каждой
      //      команды создавал независимый промис: при пачке команд (clearUserData
      //      → applyBackup слота) IPC-ответы могли примениться не в порядке
      //      вызова, и DELETE мог лечь ПОСЛЕ INSERT — в зеркале данные есть, в
      //      файле нет, после рестарта задача «пропадала».
      //   2) наблюдаемость. Теперь есть точка ожидания `flushNativeWrites()`,
      //      которую можно дождаться перед выходом из аккаунта, снимком и
      //      подменой файла БД.
      enqueueNativeWrite(sql, params);
      scheduleSave();
      return { changes: c, lastInsertRowid: i };
    }
  }
  if (!webDb) throw new Error('DB not initialized');
  webDb.run(sql, params);
  const rs = webDb.exec('SELECT changes() AS c, last_insert_rowid() AS i')[0];
  const c = (rs?.values[0]?.[0] as number) ?? 0;
  const i = (rs?.values[0]?.[1] as number) ?? 0;
  scheduleSave();
  return { changes: c, lastInsertRowid: i };
}

/**
 * F37 (ADR 0029): последовательная очередь записей в нативную SQLite (Tauri).
 *
 * `run()` обязан остаться синхронным (весь стор построен на этом), поэтому SQL
 * применяется к sql.js-зеркалу сразу, а в нативную базу уходит асинхронно. Но
 * «асинхронно» ≠ «в произвольном порядке»: цепочка ниже гарантирует, что
 * команды доедут до файла в том же порядке, в котором их вызвал код.
 *
 * Ошибка одной команды не рвёт цепочку (звено ловит её и логирует), иначе одна
 * неудачная запись остановила бы все последующие.
 */
let nativeWriteChain: Promise<void> = Promise.resolve();

function enqueueNativeWrite(sql: string, params: any[]): void {
  nativeWriteChain = nativeWriteChain.then(async () => {
    try {
      const d = await getTauriDb();
      await d.execute(sql, params);
    } catch (e) {
      console.warn('[db] native write failed:', e);
    }
  });
}

/**
 * Ждёт, пока все поставленные в очередь записи доедут до нативного файла БД.
 *
 * Вызывать перед действиями, после которых состояние в памяти будет потеряно
 * или файл будет подменён: выход из аккаунта, смена аккаунта, создание снимка,
 * restoreSnapshot, перезапуск приложения. В web-режиме — no-op.
 */
export async function flushNativeWrites(): Promise<void> {
  if (!IS_TAURI) return;
  // Двойной await: пока ждём текущую цепочку, в неё могли добавиться новые
  // звенья (например обработчики, сработавшие от того же действия).
  await nativeWriteChain;
  await nativeWriteChain;
}

let saveTimer: any = null;
function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 200);
}

export function save() {
  if (!webDb) return;
  const data = webDb.export();
  saveToStorage(data);
}

export function exportJson() {
  return {
    statuses: all('SELECT * FROM statuses ORDER BY sort_order'),
    tags: all('SELECT * FROM tags ORDER BY sort_order'),
    tasks: all('SELECT * FROM tasks ORDER BY sort_order'),
    settings: all('SELECT * FROM settings'),
  };
}

export function exportCsv(): string {
  const tasks = all<any>(`SELECT t.id, t.title, t.comment, tg.name AS tag, s.name AS status,
    t.start_date, t.deadline, t.finish_date, t.archived, t.created_at, t.updated_at
    FROM tasks t
    LEFT JOIN tags tg ON tg.id = t.tag_id
    LEFT JOIN statuses s ON s.id = t.status_id
    ORDER BY t.sort_order`);
  const headers = ['ID', 'Задача', 'Комментарий', 'Тэг', 'Статус', 'Старт', 'Дедлайн', 'Финиш', 'Архив', 'Создано', 'Обновлено'];
  const escape = (v: any) => {
    const s = v == null ? '' : String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.join(',')];
  tasks.forEach(t => {
    lines.push([t.id, t.title, t.comment, t.tag, t.status, t.start_date, t.deadline, t.finish_date, t.archived, t.created_at, t.updated_at]
      .map(escape).join(','));
  });
  return lines.join('\n');
}

export function isStorageAvailable() { return storageAvailable; }

/** Returns whether we're running inside Tauri desktop */
export function isTauri() { return IS_TAURI; }

// ─── v0.8.7: full backup/restore (tasks + tags + statuses + settings) ──────────
export interface BackupPayload {
  version: string;
  exported_at: string;
  include?: { tasks?: boolean; tags?: boolean; statuses?: boolean; templates?: boolean; workspaces?: boolean };
  statuses?: any[];
  tags?: any[];
  tasks?: any[];
  /** v0.8.13+: user-defined task templates. Optional for backward compatibility with older backups. */
  templates?: any[];
  /**
   * F28 (ADR 0021): пространства + членства. Опционально — присутствие этих
   * полей ПЕРЕКЛЮЧАЕТ applyBackup в workspace-aware режим (сохраняется
   * исходный task.workspace_id вместо штамповки единым importWsId).
   * Отсутствие полей = легаси-бэкап, старое поведение не меняется.
   */
  workspaces?: any[];
  workspace_members?: any[];
}

/**
 * Build a full backup JSON containing only the selected entity kinds.
 * `include.workspaces` (по умолчанию false — обратная совместимость со
 * снимками/экспортом, которым workspaces не нужны) добавляет в дамп
 * `workspaces`/`workspace_members`, что делает бэкап workspace-aware: их
 * присутствие в payload — единственный сигнал для applyBackup сохранять
 * исходный workspace_id задач, а не схлопывать всё в один importWsId.
 */
export function buildBackup(include: { tasks: boolean; tags: boolean; statuses: boolean; workspaces?: boolean }): BackupPayload {
  const payload: BackupPayload = {
    version: '0.8.13',
    exported_at: new Date().toISOString(),
    include: { ...include, templates: true },
  };
  if (include.statuses) payload.statuses = all('SELECT * FROM statuses ORDER BY sort_order');
  if (include.tags)     payload.tags     = all('SELECT * FROM tags ORDER BY sort_order');
  if (include.tasks)    payload.tasks    = all('SELECT * FROM tasks ORDER BY sort_order');
  // Templates are always exported (small, useful to carry between machines)
  try {
    payload.templates = all('SELECT * FROM task_templates ORDER BY sort_order, id');
  } catch {
    // table may not exist on very old DBs prior to v2 migration — ignore
    payload.templates = [];
  }
  if (include.workspaces) {
    try {
      payload.workspaces = all('SELECT * FROM workspaces WHERE deleted_at IS NULL ORDER BY sort_order, id');
    } catch {
      payload.workspaces = [];
    }
    try {
      payload.workspace_members = all('SELECT * FROM workspace_members WHERE deleted_at IS NULL ORDER BY id');
    } catch {
      payload.workspace_members = [];
    }
  }
  return payload;
}

/**
 * Apply backup payload to the live DB.
 * mode='replace' — wipes selected tables first; mode='merge' — inserts skipping duplicates by name (statuses/tags) or by (title, created_at) for tasks.
 * Returns count of rows actually applied per entity.
 */
export async function applyBackup(
  payload: BackupPayload,
  mode: 'replace' | 'merge'
): Promise<{ statuses: number; tags: number; tasks: number; templates: number; workspaces: number; workspace_members: number }> {
  const counts = { statuses: 0, tags: 0, tasks: 0, templates: 0, workspaces: 0, workspace_members: 0 };
  const has = {
    statuses: Array.isArray(payload.statuses),
    tags: Array.isArray(payload.tags),
    tasks: Array.isArray(payload.tasks),
    templates: Array.isArray(payload.templates),
    // F28 (ADR 0021): присутствие workspaces в payload — сигнал workspace-aware
    // формата. Именно ЭТО поле (а не отдельный флаг) переключает поведение
    // applyBackup, чтобы легаси-бэкапы без него продолжали работать как раньше.
    workspaces: Array.isArray(payload.workspaces),
    workspace_members: Array.isArray(payload.workspace_members),
  };
  const isWorkspaceAware = has.workspaces;

  // v0.9.35-dev.6.10.4: восстановленные строки обязаны сохранять свою
  // sync-идентичность (uuid/client_id/deleted_at/version) — иначе они
  // невидимы для outbox, и первый же pull переигрывает их обратно в
  // состояние из облака (баг: «снимок восстановлен, а задача не вернулась»).
  const nowIso = new Date().toISOString();
  const clientId = get<{ value: string }>(`SELECT value FROM settings WHERE key='client_id'`)?.value ?? null;
  // Wave A: легаси-бэкапы не несут workspace_id — штампуем восстановленные
  // строки текущим personal-пространством, иначе они выпадают из ws-scoped
  // выборок UI (регрессия Wave A PR-3: импорт → пустой список). F28: этот
  // importWsId остаётся ТОЛЬКО фолбэком для легаси-формата и для строк
  // workspace-aware бэкапа без собственного workspace_id — сам бэкап больше
  // не схлопывает разные пространства в одно (см. resolveWsId ниже).
  const importWsId =
    get<{ value: string }>(`SELECT value FROM settings WHERE key='current_workspace_id'`)?.value
    ?? get<{ value: string }>(`SELECT value FROM settings WHERE key='personal_workspace_id'`)?.value
    ?? 'ws_local';
  // F29 (ADR 0022): нормализация legacy/сиротских workspace_id ТОЛЬКО в
  // workspace-aware режиме. F28 сохраняет исходный task.workspace_id строки —
  // это обнажило старый рассинхрон: задачи первого личного пространства,
  // созданные ДО переклейки ws_local→ws_<uid> (reconcileLocalPlaceholder,
  // src/lib/sync/workspace.ts), несут legacy workspace_id='ws_local' (или иной
  // осиротевший id), которого нет среди восстановленных payload.workspaces.
  // filterByWorkspace (src/store/workspaceScope.ts) фильтрует строго по
  // равенству workspace_id===currentWorkspaceId — legacy-строки не совпадают
  // и выпадают из UI-выборок, хотя счётчики (не ws-scoped) их видят.
  //
  // Правило: если workspace_id строки ЕСТЬ среди восстановленных
  // payload.workspaces — не трогаем (F28-поведение). Если его там НЕТ
  // (legacy/сирота) — переназначаем на канонический personal ws.
  const validWsIds = new Set<string>();
  if (isWorkspaceAware) {
    for (const w of payload.workspaces!) {
      if (typeof w.uuid === 'string' && w.uuid) validWsIds.add(w.uuid);
    }
  }
  // Канонический personal: settings-указатель, ЕСЛИ он входит в восстановленный
  // набор, иначе personal-строка payload.workspaces с наименьшим sort_order
  // (первое созданное личное пространство, «Мои задачи», sort_order=0). Не
  // вычисляем computeWorkspaceId здесь — db.ts не тащит зависимость от
  // sync/workspace (см. ADR 0022).
  let canonicalPersonalWsId: string | null = null;
  if (isWorkspaceAware) {
    if (importWsId && validWsIds.has(importWsId)) {
      canonicalPersonalWsId = importWsId;
    } else {
      let best: { uuid: string; sortOrder: number } | null = null;
      for (const w of payload.workspaces!) {
        if (w.kind !== 'personal') continue;
        if (!(typeof w.uuid === 'string' && w.uuid)) continue;
        const sortOrder = typeof w.sort_order === 'number' ? w.sort_order : 0;
        if (!best || sortOrder < best.sortOrder) best = { uuid: w.uuid, sortOrder };
      }
      canonicalPersonalWsId = best?.uuid ?? null;
    }
  }
  // F28: в workspace-aware режиме сохраняем исходный workspace_id строки;
  // в легаси-режиме (нет payload.workspaces) поведение НЕ меняется — всегда importWsId.
  // F29: в workspace-aware режиме, если исходный workspace_id строки — legacy/
  // сирота (не входит в validWsIds), переназначаем на canonicalPersonalWsId
  // (если он вычислен) вместо того, чтобы оставлять недостижимый id.
  const resolveWsId = (rowWsId: unknown): string => {
    if (!isWorkspaceAware) return importWsId;
    if (typeof rowWsId !== 'string' || !rowWsId) return importWsId;
    if (validWsIds.has(rowWsId)) return rowWsId;
    return canonicalPersonalWsId ?? rowWsId;
  };
  const restoredUuids: { table: 'statuses' | 'tags' | 'tasks' | 'task_templates' | 'workspaces' | 'workspace_members'; uuid: string }[] = [];

  // Helper to do the run in both Tauri and web modes
  const sync = async (sql: string, params: any[] = []) => {
    if (IS_TAURI) {
      const d = await getTauriDb();
      await d.execute(sql, params);
    }
    if (webDb) webDb.run(sql, params);
  };

  if (mode === 'replace') {
    // Order matters: tasks reference statuses & tags via FK-like fields (no real FK, but logical)
    if (has.tasks) await sync('DELETE FROM tasks');
    if (has.templates) {
      try { await sync('DELETE FROM task_templates'); } catch { /* table may not exist yet */ }
    }
    if (has.tags) await sync('DELETE FROM tags');
    if (has.statuses) await sync('DELETE FROM statuses');
    // F28 (ADR 0021): только в workspace-aware режиме — легаси-бэкап пространства не трогает.
    if (has.workspace_members) {
      try { await sync('DELETE FROM workspace_members'); } catch { /* table may not exist on old DBs */ }
    }
    if (has.workspaces) {
      try { await sync('DELETE FROM workspaces'); } catch { /* table may not exist on old DBs */ }
    }
  }

  // F28: восстанавливаем пространства ПЕРВЫМИ — задачи/статусы/теги ниже ссылаются на
  // их workspace_id через resolveWsId. Сохраняем uuid/version/deleted_at/client_id —
  // та же sync-идентичность, что и у таск/статусов/тегов (v0.9.35-dev.6.10.4).
  if (has.workspaces) {
    const existingWs = mode === 'merge'
      ? new Set(all<any>('SELECT uuid FROM workspaces').map(r => String(r.uuid)))
      : new Set<string>();
    for (const w of payload.workspaces!) {
      const uuid = typeof w.uuid === 'string' && w.uuid ? w.uuid : ('ws_' + uuidv7().replace(/-/g, ''));
      if (mode === 'merge' && existingWs.has(uuid)) continue;
      const version = typeof w.version === 'number' ? w.version + 1 : 1;
      // F33 (ADR 0026): replace-режим DELETE+INSERT не в единой транзакции — к моменту
      // INSERT personal-пространство может уже существовать (пересоздано reconcilePersonalWorkspace,
      // который по контракту выполняется до restore) → UNIQUE constraint failed: workspaces.uuid.
      // OR REPLACE безопасен: связи (tasks/statuses/tags/templates) идут по uuid-строке, не по
      // числовому id, так что подмена numeric id при REPLACE не рвёт FK-подобные ссылки.
      await sync(
        `INSERT OR REPLACE INTO workspaces (uuid, name, kind, owner_id, sort_order, created_at, updated_at, deleted_at, version, client_id) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [uuid, String(w.name ?? 'Мои задачи'), String(w.kind ?? 'personal'), w.owner_id ?? null, w.sort_order ?? 0, w.created_at ?? nowIso, nowIso, w.deleted_at ?? null, version, w.client_id ?? clientId]
      );
      counts.workspaces++;
      restoredUuids.push({ table: 'workspaces', uuid });
    }
  }

  if (has.workspace_members) {
    const existingMembers = mode === 'merge'
      ? new Set(all<any>('SELECT uuid FROM workspace_members').map(r => String(r.uuid)))
      : new Set<string>();
    for (const m of payload.workspace_members!) {
      const uuid = typeof m.uuid === 'string' && m.uuid ? m.uuid : uuidv7();
      if (mode === 'merge' && existingMembers.has(uuid)) continue;
      if (!m.workspace_id || !m.user_id) continue;
      const version = typeof m.version === 'number' ? m.version + 1 : 1;
      // F33 (ADR 0026): same replace-mode race as workspaces above, second UNIQUE variant
      // from the log — UNIQUE constraint failed: workspace_members.workspace_id, workspace_members.user_id.
      // OR IGNORE (not REPLACE) here: keeps the existing member row's identity untouched when a
      // duplicate (workspace_id, user_id) or uuid is hit, instead of swapping owner-row identity.
      await sync(
        `INSERT OR IGNORE INTO workspace_members (uuid, workspace_id, user_id, role, invited_by, joined_at, created_at, updated_at, deleted_at, version, client_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [uuid, m.workspace_id, m.user_id, String(m.role ?? 'owner'), m.invited_by ?? null, m.joined_at ?? nowIso, m.created_at ?? nowIso, nowIso, m.deleted_at ?? null, version, m.client_id ?? clientId]
      );
      counts.workspace_members++;
      restoredUuids.push({ table: 'workspace_members', uuid });
    }
  }

  // Apply in order: statuses → tags → tasks (so referenced ids exist)
  if (has.statuses) {
    // Existing names for merge dedup
    const existing = mode === 'merge'
      ? new Set(all<any>('SELECT name FROM statuses').map(r => String(r.name).toLowerCase()))
      : new Set<string>();
    for (const s of payload.statuses!) {
      const name = String(s.name ?? '').trim();
      if (!name) continue;
      if (mode === 'merge' && existing.has(name.toLowerCase())) continue;
      const uuid = typeof s.uuid === 'string' && s.uuid ? s.uuid : uuidv7();
      const version = typeof s.version === 'number' ? s.version + 1 : 1;
      await sync(
        `INSERT INTO statuses (name, color, behavior, sort_order, is_seed, is_technical, hidden, default_collapsed, uuid, updated_at, deleted_at, version, client_id, workspace_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [name, s.color ?? '#888', s.behavior ?? 'middle', s.sort_order ?? 0, s.is_seed ?? 0, s.is_technical ?? 0, s.hidden ?? 0, s.default_collapsed ?? 0,
         uuid, nowIso, s.deleted_at ?? null, version, s.client_id ?? clientId, resolveWsId(s.workspace_id)]
      );
      counts.statuses++;
      restoredUuids.push({ table: 'statuses', uuid });
    }
  }

  if (has.tags) {
    const existing = mode === 'merge'
      ? new Set(all<any>('SELECT name FROM tags').map(r => String(r.name).toLowerCase()))
      : new Set<string>();
    for (const t of payload.tags!) {
      const name = String(t.name ?? '').trim();
      if (!name) continue;
      if (mode === 'merge' && existing.has(name.toLowerCase())) continue;
      const uuid = typeof t.uuid === 'string' && t.uuid ? t.uuid : uuidv7();
      const version = typeof t.version === 'number' ? t.version + 1 : 1;
      await sync(
        `INSERT INTO tags (name, color, sort_order, uuid, updated_at, deleted_at, version, client_id, workspace_id) VALUES (?,?,?,?,?,?,?,?,?)`,
        [name, t.color ?? '#888', t.sort_order ?? 0, uuid, nowIso, t.deleted_at ?? null, version, t.client_id ?? clientId, resolveWsId(t.workspace_id)]
      );
      counts.tags++;
      restoredUuids.push({ table: 'tags', uuid });
    }
  }

  if (has.tasks) {
    // Build name→id maps for statuses and tags (current state, after status/tag import).
    // F32 (ADR 0025): статусы восстанавливаются workspace-aware (resolveWsId выше), но эта
    // мапа исторически была ТОЛЬКО по имени — при 2+ пространствах с одноимёнными сид-статусами
    // («Сегодня», «Взять в работу», ...) последняя запись перетирала предыдущую, и задача из
    // ws A получала status_id статуса из ws B (доска рендерит по текущему ws → задача невидима).
    // Держим ОБЕ мапы: workspace-aware (основная) + по имени (fallback для легаси-бэкапов,
    // где у статусов/тегов ещё нет workspace_id).
    const statusByName = new Map<string, number>();
    for (const r of all<any>('SELECT id, name FROM statuses')) statusByName.set(String(r.name).toLowerCase(), r.id);
    const tagByName = new Map<string, number>();
    for (const r of all<any>('SELECT id, name FROM tags')) tagByName.set(String(r.name).toLowerCase(), r.id);
    const statusByWsName = new Map<string, number>();
    for (const r of all<any>('SELECT id, name, workspace_id FROM statuses')) statusByWsName.set(`${r.workspace_id ?? ''}|${String(r.name).toLowerCase()}`, r.id);
    const tagByWsName = new Map<string, number>();
    for (const r of all<any>('SELECT id, name, workspace_id FROM tags')) tagByWsName.set(`${r.workspace_id ?? ''}|${String(r.name).toLowerCase()}`, r.id);

    // For dedup in merge mode
    const existingTasks = mode === 'merge'
      ? new Set(all<any>('SELECT title || "|" || COALESCE(created_at, "") AS k FROM tasks').map(r => String(r.k)))
      : new Set<string>();

    // Original payload status/tag id→name mapping (so we can re-resolve by name in the new DB)
    const origStatuses = new Map<number, string>();
    if (has.statuses) for (const s of payload.statuses!) origStatuses.set(s.id, String(s.name ?? ''));
    const origTags = new Map<number, string>();
    if (has.tags) for (const t of payload.tags!) origTags.set(t.id, String(t.name ?? ''));
    // F32: id→workspace_id из payload (исходный, «старый» ws_id дампа). Прогоняем через ту
    // же resolveWsId, что использовалась при вставке statuses/tags выше, чтобы получить
    // АКТУАЛЬНЫЙ ws_id, под которым статус/тег реально лежит в текущей БД.
    const origStatusWs = new Map<number, string>();
    if (has.statuses) for (const s of payload.statuses!) origStatusWs.set(s.id, String(s.workspace_id ?? ''));
    const origTagWs = new Map<number, string>();
    if (has.tags) for (const t of payload.tags!) origTagWs.set(t.id, String(t.workspace_id ?? ''));

    const now = new Date().toISOString();
    const fallbackStatus = all<any>(`SELECT id FROM statuses WHERE behavior IN ('top','middle') ORDER BY sort_order LIMIT 1`)[0]?.id
                       ?? all<any>('SELECT id FROM statuses ORDER BY id LIMIT 1')[0]?.id ?? 1;

    for (const t of payload.tasks!) {
      const title = String(t.title ?? '').trim();
      if (!title) continue;
      const key = `${title}|${t.created_at ?? ''}`;
      if (mode === 'merge' && existingTasks.has(key)) continue;

      // Re-resolve status_id: сначала workspace-aware ключ (ws задачи в payload может
      // отличаться от ws статуса в payload при мультиworkspace-бэкапе — поэтому берём ws
      // САМОГО статуса, не задачи), затем fallback на старую по-имени мапу (легаси-бэкапы
      // без workspace_id у статусов).
      let statusId: number = fallbackStatus;
      if (t.status_id != null) {
        const origName = origStatuses.get(t.status_id);
        if (origName) {
          const origWs = origStatusWs.has(t.status_id) ? resolveWsId(origStatusWs.get(t.status_id)) : undefined;
          const newId = (origWs !== undefined ? statusByWsName.get(`${origWs}|${origName.toLowerCase()}`) : undefined)
                     ?? statusByName.get(origName.toLowerCase());
          if (newId) statusId = newId;
        }
      }
      // Re-resolve tag_id: то же самое, ws-aware ключ + fallback по имени. tag_id может
      // оставаться null — сохраняем эту обработку без изменений.
      let tagId: number | null = null;
      if (t.tag_id != null) {
        const origName = origTags.get(t.tag_id);
        if (origName) {
          const origWs = origTagWs.has(t.tag_id) ? resolveWsId(origTagWs.get(t.tag_id)) : undefined;
          tagId = (origWs !== undefined ? tagByWsName.get(`${origWs}|${origName.toLowerCase()}`) : undefined)
               ?? tagByName.get(origName.toLowerCase())
               ?? null;
        }
      }

      const uuid = typeof t.uuid === 'string' && t.uuid ? t.uuid : uuidv7();
      const version = typeof t.version === 'number' ? t.version + 1 : 1;
      await sync(
        `INSERT INTO tasks (title, comment, tag_id, status_id, start_date, deadline, finish_date, created_at, updated_at, sort_order, archived, uuid, deleted_at, version, client_id, workspace_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          title,
          t.comment ?? '',
          tagId,
          statusId,
          t.start_date ?? null,
          t.deadline ?? null,
          t.finish_date ?? null,
          t.created_at ?? now,
          nowIso,
          t.sort_order ?? 0,
          t.archived ?? 0,
          uuid,
          t.deleted_at ?? null,
          version,
          t.client_id ?? clientId,
          resolveWsId(t.workspace_id),
        ]
      );
      counts.tasks++;
      restoredUuids.push({ table: 'tasks', uuid });
    }
  }

  // Templates: apply after statuses/tags so we can resolve names→ids the same way
  if (has.templates) {
    // Re-build status/tag name maps (statuses/tags may have just been merged or replaced)
    const statusByName = new Map<string, number>();
    for (const r of all<any>('SELECT id, name FROM statuses')) statusByName.set(String(r.name).toLowerCase(), r.id);
    const tagByName = new Map<string, number>();
    for (const r of all<any>('SELECT id, name FROM tags')) tagByName.set(String(r.name).toLowerCase(), r.id);

    const origStatuses = new Map<number, string>();
    if (has.statuses) for (const s of payload.statuses!) origStatuses.set(s.id, String(s.name ?? ''));
    const origTags = new Map<number, string>();
    if (has.tags) for (const t of payload.tags!) origTags.set(t.id, String(t.name ?? ''));

    const existingTemplates = mode === 'merge'
      ? new Set(all<any>('SELECT LOWER(name) AS k FROM task_templates').map(r => String(r.k)))
      : new Set<string>();

    for (const tpl of payload.templates!) {
      const name = String(tpl.name ?? '').trim();
      if (!name) continue;
      if (mode === 'merge' && existingTemplates.has(name.toLowerCase())) continue;

      let statusId: number | null = null;
      if (tpl.status_id != null) {
        const origName = origStatuses.get(tpl.status_id);
        if (origName) statusId = statusByName.get(origName.toLowerCase()) ?? null;
      }
      let tagId: number | null = null;
      if (tpl.tag_id != null) {
        const origName = origTags.get(tpl.tag_id);
        if (origName) tagId = tagByName.get(origName.toLowerCase()) ?? null;
      }

      try {
        const uuid = typeof tpl.uuid === 'string' && tpl.uuid ? tpl.uuid : uuidv7();
        const version = typeof tpl.version === 'number' ? tpl.version + 1 : 1;
        await sync(
          `INSERT INTO task_templates (name, title, comment, status_id, tag_id, sort_order, uuid, updated_at, deleted_at, version, client_id, workspace_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          [name, String(tpl.title ?? ''), String(tpl.comment ?? ''), statusId, tagId, tpl.sort_order ?? 0, uuid, nowIso, tpl.deleted_at ?? null, version, tpl.client_id ?? clientId, resolveWsId(tpl.workspace_id)]
        );
        counts.templates++;
        restoredUuids.push({ table: 'task_templates', uuid });
      } catch {
        // task_templates table missing (very old DB without v2 migration) — skip silently
      }
    }
  }

  // v0.9.35-dev.6.10.4: ставим все восстановленные строки в очередь на push —
  // иначе они остаются локальными «призраками», а следующий pull затирает
  // их обратно состоянием из облака (не пушим сами — не знаем, что менялось).
  for (const { table, uuid } of restoredUuids) {
    try {
      await sync(
        `INSERT INTO sync_outbox (entity_table, entity_uuid, op, queued_at, attempt_count) VALUES (?,?,?,datetime('now'),0)
         ON CONFLICT(entity_table, entity_uuid) DO UPDATE SET op=excluded.op, queued_at=excluded.queued_at, attempt_count=0, last_attempt_at=NULL, last_error=NULL`,
        [table, uuid, 'upsert']
      );
    } catch (e) {
      console.warn('[applyBackup] enqueue outbox failed for', table, uuid, e);
    }
  }

  // Persist webDb to localStorage in web mode
  if (!IS_TAURI) save();
  return counts;
}

// ─── F32 (ADR 0025): repairTaskStatusWorkspaceMismatch ─────────────────────
//
// Доказано на реальной data.db пользователя (2026-08-03): applyBackup (до
// этого фикса) перепривязывал task.status_id по ИМЕНИ статуса без учёта
// workspace_id (см. statusByName выше). При 2+ пространствах с одноимёнными
// сид-статусами («Сегодня», «Взять в работу», ...) это привело к тому, что
// часть задач в БД пользователя УЖЕ ссылается на status_id из ЧУЖОГО
// пространства. Доска рендерит колонки по статусам ТЕКУЩЕГО workspace — такие
// задачи не находят колонку и невидимы, хотя счётчик (считает по
// workspace_id задачи, не статуса) показывает верное число. Ровно симптом
// пользователя: «после переключения аккаунта доска пустая, счётчик верный».
//
// Функция чинит уже испорченные на диске данные: для каждой задачи, чей
// статус принадлежит ДРУГОМУ workspace, перепривязывает её на одноимённый
// статус её СОБСТВЕННОГО workspace (если такой есть). Если одноимённого
// статуса в целевом workspace нет — задача НЕ трогается (данные не теряем,
// не удаляем задачи никогда).
//
// Идемпотентна: повторный вызов — no-op, т.к. условие MISMATCH (status.workspace_id
// <> tasks.workspace_id) перестаёт выполняться сразу после починки. Безопасна
// в обоих режимах (web webDb + Tauri native) — использует тот же execBoth-паттерн,
// что и ensureSeededIfEmpty().
export async function repairTaskStatusWorkspaceMismatch(): Promise<number> {
  const REPAIR_SQL = `
    UPDATE tasks
    SET status_id = (
      SELECT s2.id FROM statuses s2
      WHERE s2.workspace_id = tasks.workspace_id AND s2.deleted_at IS NULL
        AND lower(s2.name) = (SELECT lower(s1.name) FROM statuses s1 WHERE s1.id = tasks.status_id)
      ORDER BY s2.sort_order LIMIT 1
    )
    WHERE deleted_at IS NULL
      AND status_id IN (SELECT s.id FROM statuses s WHERE s.id = tasks.status_id AND s.workspace_id <> tasks.workspace_id)
      AND EXISTS (
        SELECT 1 FROM statuses s2
        WHERE s2.workspace_id = tasks.workspace_id AND s2.deleted_at IS NULL
          AND lower(s2.name) = (SELECT lower(s1.name) FROM statuses s1 WHERE s1.id = tasks.status_id)
      )
  `;
  let changes = 0;
  try {
    if (webDb) {
      webDb.run(REPAIR_SQL);
      const rs = webDb.exec('SELECT changes() AS c')[0];
      changes = (rs?.values[0]?.[0] as number) ?? 0;
    }
  } catch (e) {
    console.warn('[repairTaskStatusWorkspaceMismatch][web]', e);
  }
  if (IS_TAURI) {
    try {
      const d = await getTauriDb();
      await d.execute(REPAIR_SQL);
    } catch (e) {
      console.warn('[repairTaskStatusWorkspaceMismatch][tauri]', e);
    }
  }
  if (!IS_TAURI && webDb) save();
  return changes;
}
