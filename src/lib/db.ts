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

const STORAGE_KEY = 'taskflow.sqlite.v1';
const STORAGE_KEY_TS = 'taskflow.sqlite.v1.ts';

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

  // Ensure technical "Удалено" status exists
  try {
    const rows: any[] = await d.select(`SELECT id FROM statuses WHERE is_technical=1 LIMIT 1`);
    if (rows.length === 0) {
      const maxRows: any[] = await d.select(`SELECT COALESCE(MAX(sort_order),0)+1 AS m FROM statuses`);
      const max = maxRows[0]?.m ?? 0;
      await d.execute(
        `INSERT INTO statuses (name, color, behavior, sort_order, is_seed, is_technical, hidden, default_collapsed) VALUES (?,?,?,?,?,?,?,?)`,
        ['Удалено', '#5A5957', 'archive', max, 1, 1, 1, 0]
      );
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
  const statuses = [
    { name: 'Важно',         color: '#EE204D', behavior: 'top',    hidden: 0, default_collapsed: 0 },
    { name: 'Сегодня',       color: '#C44A8E', behavior: 'top',    hidden: 0, default_collapsed: 0 },
    { name: 'Взять в работу', color: '#FFFFFF', behavior: 'middle', hidden: 0, default_collapsed: 0 },
    { name: 'В процессе',    color: '#D98F2B', behavior: 'middle', hidden: 0, default_collapsed: 0 },
    { name: 'Приостановлено', color: '#7A7974', behavior: 'bottom', hidden: 0, default_collapsed: 0 },
    { name: 'Выполнено',     color: '#437A22', behavior: 'archive', hidden: 0, default_collapsed: 1 },
  ];
  for (let i = 0; i < statuses.length; i++) {
    const s = statuses[i];
    await d.execute(
      'INSERT INTO statuses (name, color, behavior, sort_order, is_seed, is_technical, hidden, default_collapsed) VALUES (?,?,?,?,1,0,?,?)',
      [s.name, s.color, s.behavior, i, s.hidden, s.default_collapsed]
    );
  }

  const tags = [
    { name: 'OPS', color: '#5B7FB8' },
    { name: 'DEV', color: '#437A22' },
    { name: 'MTG', color: '#C44A8E' },
    { name: 'LRN', color: '#D98F2B' },
    { name: 'PRS', color: '#7A7974' },
  ];
  for (let i = 0; i < tags.length; i++) {
    await d.execute('INSERT INTO tags (name, color, sort_order) VALUES (?,?,?)', [tags[i].name, tags[i].color, i]);
  }

  // Find "Сегодня" status and "PRS" tag IDs
  const statusRows: any[] = await d.select(`SELECT id FROM statuses WHERE name='Сегодня' LIMIT 1`);
  const tagRows: any[] = await d.select(`SELECT id FROM tags WHERE name='PRS' LIMIT 1`);
  const statusId = statusRows[0]?.id ?? 1;
  const tagId = tagRows[0]?.id ?? null;

  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const deadline = new Date(today);
  deadline.setDate(deadline.getDate() + 3);
  const deadlineStr = deadline.toISOString().slice(0, 10);

  await d.execute(
    `INSERT INTO tasks (title, comment, tag_id, status_id, start_date, deadline, finish_date, created_at, updated_at, sort_order, archived)
     VALUES (?,?,?,?,?,?,?,?,?,?,0)`,
    [
      'Добро пожаловать в TaskFlow',
      'Нажмите ✓ справа, чтобы выполнить задачу, или иконка корзины 🗑 в правом верхнем углу — чтобы удалить.',
      tagId, statusId, todayStr, deadlineStr, null, now, now, 0,
    ]
  );

  const defaults = [
    ['language', 'ru'],
    ['theme', 'light'],
    ['stats_enabled', '1'],
    ['default_tab', 'tasks'],
    ['font_size', '14'],
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

function seed(d: Database) {
  const now = new Date().toISOString();
  // v0.8.2: hidden and default_collapsed per status
  const statuses = [
    { name: 'Важно',         color: '#EE204D', behavior: 'top',     hidden: 0, default_collapsed: 0 },
    { name: 'Сегодня',       color: '#C44A8E', behavior: 'top',     hidden: 0, default_collapsed: 0 },
    { name: 'Взять в работу', color: '#FFFFFF', behavior: 'middle', hidden: 0, default_collapsed: 0 },
    { name: 'В процессе',    color: '#D98F2B', behavior: 'middle',  hidden: 0, default_collapsed: 0 },
    { name: 'Приостановлено', color: '#7A7974', behavior: 'bottom', hidden: 0, default_collapsed: 0 },
    { name: 'Выполнено',     color: '#437A22', behavior: 'archive', hidden: 0, default_collapsed: 1 }, // visible but collapsed by default
  ];
  statuses.forEach((s, i) => {
    d.run('INSERT INTO statuses (name, color, behavior, sort_order, is_seed, is_technical, hidden, default_collapsed) VALUES (?,?,?,?,1,0,?,?)',
      [s.name, s.color, s.behavior, i, s.hidden, s.default_collapsed]);
  });

  const tags = [
    { name: 'OPS', color: '#5B7FB8' },
    { name: 'DEV', color: '#437A22' },
    { name: 'MTG', color: '#C44A8E' },
    { name: 'LRN', color: '#D98F2B' },
    { name: 'PRS', color: '#7A7974' },
  ];
  tags.forEach((t, i) => {
    d.run('INSERT INTO tags (name, color, sort_order) VALUES (?,?,?)', [t.name, t.color, i]);
  });

  // Welcome seed task (single task)
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const deadlineDate = new Date(today);
  deadlineDate.setDate(deadlineDate.getDate() + 3);
  const deadlineStr = deadlineDate.toISOString().slice(0, 10);

  // Get the "Сегодня" status (index 1 → id 2) and "PRS" tag (index 4 → id 5)
  const statusStmt = d.prepare(`SELECT id FROM statuses WHERE name='Сегодня' LIMIT 1`);
  let statusId = 2;
  if (statusStmt.step()) { statusId = (statusStmt.getAsObject() as any).id as number; }
  statusStmt.free();

  const tagStmt = d.prepare(`SELECT id FROM tags WHERE name='PRS' LIMIT 1`);
  let tagId: number | null = null;
  if (tagStmt.step()) { tagId = (tagStmt.getAsObject() as any).id as number; }
  tagStmt.free();

  d.run(
    `INSERT INTO tasks (title, comment, tag_id, status_id, start_date, deadline, finish_date, created_at, updated_at, sort_order, archived)
     VALUES (?,?,?,?,?,?,?,?,?,?,0)`,
    [
      'Добро пожаловать в TaskFlow',
      'Нажмите ✓ справа, чтобы выполнить задачу, или иконка корзины 🗑 в правом верхнем углу — чтобы удалить.',
      tagId, statusId, todayStr, deadlineStr, null, now, now, 0,
    ]
  );

  const defaults = [
    ['language', 'ru'],
    ['theme', 'light'],
    ['stats_enabled', '1'],
    ['default_tab', 'tasks'],
    ['font_size', '14'],
  ];
  defaults.forEach(([k, v]) => d.run('INSERT OR IGNORE INTO settings (key, value) VALUES (?,?)', [k, v]));
}

// ─── resetDatabase: clear all data and re-seed ───────────────────────────────
export function resetDatabase() {
  // Clear localStorage
  tryStorage(() => { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(STORAGE_KEY_TS); return null; }, null);

  // If webDb is alive, wipe tables and re-seed directly (no page reload needed in web mode)
  if (webDb) {
    try {
      webDb.run('DELETE FROM tasks');
      webDb.run('DELETE FROM tags');
      webDb.run('DELETE FROM statuses');
      webDb.run('DELETE FROM settings');
      seed(webDb);
      // Insert technical "Удалено" status
      const stmt = webDb.prepare('SELECT COALESCE(MAX(sort_order),0)+1 AS m FROM statuses');
      stmt.step();
      const max = (stmt.getAsObject() as any).m as number;
      stmt.free();
      webDb.run(
        `INSERT INTO statuses (name, color, behavior, sort_order, is_seed, is_technical, hidden, default_collapsed) VALUES (?,?,?,?,?,?,?,?)`,
        ['Удалено', '#5A5957', 'archive', max, 1, 1, 1, 0]
      );
      save();
    } catch (e) {
      console.error('resetDatabase error:', e);
    }
  }

  // Reset tauri db reference so it re-inits on next load
  tauriDb = null;
}

// ─── PUBLIC init ──────────────────────────────────────────────────────────────
export async function initDb(): Promise<void> {
  // Always initialise the in-memory sql.js database as a synchronous cache layer.
  // In Tauri mode we additionally set up the native SQLite and sync data into webDb.
  if (!SQL) {
    SQL = await initSqlJs({ locateFile: () => wasmUrl as string });
  }

  if (IS_TAURI) {
    // Set up native SQLite
    await tauriEnsureSchema();
    // ВАЖНО: мигрируем ДО seed, иначе для старых БД INSERT из seed падает
    // на отсутствующих колонках (hidden / default_collapsed / is_technical).
    await tauriMigrate();
    const empty = await tauriIsEmpty();
    if (empty) await tauriSeed();

    // Pull data from Tauri DB into webDb (in-memory) so sync calls work
    const d = await getTauriDb();
    const statuses: any[] = await d.select('SELECT * FROM statuses ORDER BY sort_order');
    const tags: any[] = await d.select('SELECT * FROM tags ORDER BY sort_order');
    const tasks: any[] = await d.select('SELECT * FROM tasks ORDER BY sort_order');
    const settings: any[] = await d.select('SELECT * FROM settings');

    webDb = new SQL!.Database();
    ensureSchema(webDb);
    migrate(webDb);

    // Populate webDb from Tauri data
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
    if (webDb) return;
    const stored = loadFromStorage();
    webDb = stored ? new SQL.Database(stored) : new SQL.Database();
    ensureSchema(webDb);
    migrate(webDb); // migrate BEFORE seed — по тем же причинам, что и в Tauri-ветке
    if (!stored) seed(webDb);
    save();
  }
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
      // Fire-and-forget to Tauri DB
      getTauriDb().then((d: any) => d.execute(sql, params)).catch(console.warn);
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
