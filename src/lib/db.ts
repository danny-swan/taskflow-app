// db.ts — SQLite (sql.js) adapter with localStorage persistence.
import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
// @ts-ignore
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

const STORAGE_KEY = 'taskflow.sqlite.v1';
const STORAGE_KEY_TS = 'taskflow.sqlite.v1.ts';

let SQL: SqlJsStatic | null = null;
let db: Database | null = null;
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

export async function initDb(): Promise<Database> {
  if (db) return db;
  if (!SQL) {
    SQL = await initSqlJs({ locateFile: () => wasmUrl as string });
  }
  const stored = loadFromStorage();
  db = stored ? new SQL.Database(stored) : new SQL.Database();
  ensureSchema(db);
  if (!stored) seed(db);
  migrate(db);
  save();
  return db;
}

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
  // tasks.deadline
  if (!columnExists(d, 'tasks', 'deadline')) {
    d.run(`ALTER TABLE tasks ADD COLUMN deadline TEXT`);
    // Best-effort migration: copy old finish_date into deadline so legacy data preserved.
    d.run(`UPDATE tasks SET deadline = finish_date WHERE deadline IS NULL AND finish_date IS NOT NULL`);
    // Then clear finish_date for non-completed tasks (heuristic: keep finish_date only on archive-status tasks).
    d.run(`UPDATE tasks SET finish_date = NULL
           WHERE status_id NOT IN (SELECT id FROM statuses WHERE behavior='archive')`);
  }
  // tasks.archived
  if (!columnExists(d, 'tasks', 'archived')) {
    d.run(`ALTER TABLE tasks ADD COLUMN archived INTEGER NOT NULL DEFAULT 0`);
  }
  // statuses.is_technical
  if (!columnExists(d, 'statuses', 'is_technical')) {
    d.run(`ALTER TABLE statuses ADD COLUMN is_technical INTEGER NOT NULL DEFAULT 0`);
  }
  // Ensure technical "Удалено" status exists
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
    d.run(`INSERT INTO statuses (name, color, behavior, sort_order, is_seed, is_technical) VALUES (?,?,?,?,?,?)`,
      ['Удалено', '#5A5957', 'archive', max, 1, 1]);
  }
}

function seed(d: Database) {
  const now = new Date().toISOString();
  const statuses = [
    { name: 'Важно', color: '#EE204D', behavior: 'top' },
    { name: 'Сегодня', color: '#C44A8E', behavior: 'top' },
    { name: 'Взять в работу', color: '#FFFFFF', behavior: 'middle' },
    { name: 'В процессе', color: '#D98F2B', behavior: 'middle' },
    { name: 'Приостановлено', color: '#7A7974', behavior: 'bottom' },
    { name: 'Выполнено', color: '#437A22', behavior: 'archive' },
  ];
  statuses.forEach((s, i) => {
    d.run('INSERT INTO statuses (name, color, behavior, sort_order, is_seed, is_technical) VALUES (?,?,?,?,1,0)',
      [s.name, s.color, s.behavior, i]);
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

  // Demo tasks. Some have deadlines; one is overdue, one is "today", one done.
  const today = new Date();
  const iso = (offset: number) => {
    const d2 = new Date(today);
    d2.setDate(d2.getDate() + offset);
    return d2.toISOString().slice(0, 10);
  };
  const tasks = [
    { title: 'Подготовить квартальный отчёт для совета директоров', comment: 'Свести цифры по выручке, маркетингу и операциям. Шаблон в Notion.', tag: 1, status: 1, start: iso(-3), deadline: iso(2) },
    { title: 'Согласовать бюджет на Q4', comment: 'Финал с CFO до пятницы.', tag: 1, status: 1, start: iso(-1), deadline: iso(0) },
    { title: 'Звонок с подрядчиком по интеграции CRM', comment: 'Проверить готовность API и сроки.', tag: 3, status: 2, start: iso(-2), deadline: iso(-1) },
    { title: 'Дочитать главу про распределённые системы', comment: 'Designing Data-Intensive Applications, гл. 7.', tag: 4, status: 2, start: iso(-5), deadline: null },
    { title: 'Ревью PR #482 — модуль авторизации', comment: 'Проверить покрытие тестами, безопасность токенов.', tag: 2, status: 3, start: iso(-1), deadline: iso(3) },
    { title: 'Подготовить демо для пользовательского тестирования', comment: 'Сценарии записать заранее, прогнать на двоих коллегах.', tag: 2, status: 4, start: iso(-2), deadline: iso(5) },
    { title: 'Обновить документацию API после рефакторинга', comment: 'Postman-коллекция, OpenAPI спека, примеры запросов.', tag: 2, status: 4, start: iso(-7), deadline: iso(10) },
    { title: 'Записаться к врачу — плановый осмотр', comment: '', tag: 5, status: 5, start: iso(-10), deadline: null },
    { title: 'Настроить мониторинг алертов в Grafana', comment: 'Дашборд готов, алерты в Telegram-бот.', tag: 1, status: 6, start: iso(-12), deadline: iso(-7), finish: iso(-6) },
    { title: 'Прочитать статью про React Server Components', comment: 'Сохранил в Pocket, читать в выходные.', tag: 4, status: 6, start: iso(-8), deadline: null, finish: iso(-2) },
  ];
  tasks.forEach((t, i) => {
    d.run(`INSERT INTO tasks (title, comment, tag_id, status_id, start_date, deadline, finish_date, created_at, updated_at, sort_order, archived)
      VALUES (?,?,?,?,?,?,?,?,?,?,0)`,
      [t.title, t.comment, t.tag, t.status, t.start, t.deadline, (t as any).finish ?? null, now, now, i]);
  });

  const defaults = [
    ['language', 'ru'],
    ['theme', 'light'],
    ['stats_enabled', '1'],
    ['default_tab', 'tasks'],
    ['font_size', '14'],
  ];
  defaults.forEach(([k, v]) => d.run('INSERT INTO settings (key, value) VALUES (?,?)', [k, v]));
}

export function all<T = any>(sql: string, params: any[] = []): T[] {
  if (!db) throw new Error('DB not initialized');
  const stmt = db.prepare(sql);
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
  if (!db) throw new Error('DB not initialized');
  db.run(sql, params);
  const rs = db.exec('SELECT changes() AS c, last_insert_rowid() AS i')[0];
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
  if (!db) return;
  const data = db.export();
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

export function resetDatabase() {
  tryStorage(() => { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(STORAGE_KEY_TS); return null; }, null);
  db = null;
}
