import { create } from 'zustand';
import * as db from '../lib/db';
import type { Lang } from '../lib/i18n';
import { pickQuote, quoteSetFor } from '../lib/quotes';

export type ThemeName = 'light' | 'dark' | 'akatsuki' | 'konoha';

export interface Status {
  id: number;
  name: string;
  color: string;
  behavior: 'top' | 'middle' | 'bottom' | 'archive' | string;
  sort_order: number;
  is_seed: number;
  is_technical: number;
  /** v0.8.2: hidden=true means status is not shown on the task board (but visible in Stats/Dashboard) */
  hidden: number;
  /** v0.8.2: defaultCollapsed=true means the status section is collapsed by default on the board */
  default_collapsed: number;
}
export interface Tag {
  id: number;
  name: string;
  color: string;
  sort_order: number;
}
export interface Task {
  id: number;
  title: string;
  comment: string;
  tag_id: number | null;
  status_id: number;
  start_date: string | null;
  deadline: string | null;
  finish_date: string | null;
  created_at: string;
  updated_at: string;
  sort_order: number;
  archived: number;
}

interface State {
  ready: boolean;
  statuses: Status[];        // all statuses incl technical (for stats)
  tags: Tag[];
  tasks: Task[];             // all tasks incl archived/deleted (full set)
  language: Lang;
  theme: ThemeName;
  statsEnabled: boolean;
  fontSize: number;
  defaultTab: string;
  toasts: { id: number; text: string }[];
  quote: string;
  columnWidths: Record<string, number>;
  taskStatusFilter: string | null; // for metric chips: 'total' | 'inprogress' | 'paused' | 'done' | null
  recentEmojis: string[];          // v0.8.8: недавние эмодзи для пикера (макс. 12)

  // Derived helpers
  getDeletedStatusId(): number | undefined;
  visibleStatuses(): Status[];                 // for Tasks screen (no technical, no hidden)
  visibleTasks(): Task[];                      // for Tasks screen (no archived)
  allTasks(): Task[];                          // for Stats / Dashboard

  init(): Promise<void>;
  refresh(): void;

  setLanguage(l: Lang): void;
  setTheme(t: ThemeName): void;
  setStatsEnabled(v: boolean): void;
  setFontSize(n: number): void;
  setDefaultTab(t: string): void;

  addTask(p: Partial<Task>): number;
  updateTask(id: number, p: Partial<Task>): void;
  softDeleteTask(id: number): void;
  permanentlyDeleteTask(id: number): void;
  reorderTasks(statusId: number, ids: number[]): void;

  addTag(name: string, color: string): number;
  updateTag(id: number, p: Partial<Tag>): void;
  deleteTag(id: number): void;

  addStatus(name: string, color: string, behavior: string): number;
  updateStatus(id: number, p: Partial<Status>): void;
  deleteStatus(id: number): void;
  reorderStatuses(ids: number[]): void;

  pushToast(text: string): void;
  dismissToast(id: number): void;

  setColumnWidth(key: string, w: number): void;
  setTaskStatusFilter(f: string | null): void;

  pushRecentEmoji(emoji: string): void;
}

let toastId = 0;

export const useStore = create<State>((set, get) => ({
  ready: false,
  statuses: [],
  tags: [],
  tasks: [],
  language: 'ru',
  theme: 'light',
  statsEnabled: true,
  fontSize: 14,
  defaultTab: 'tasks',
  toasts: [],
  quote: '',
  columnWidths: {},
  taskStatusFilter: null,
  recentEmojis: [],

  getDeletedStatusId() {
    return get().statuses.find(s => s.is_technical === 1 && s.name === 'Удалено')?.id;
  },
  visibleStatuses() {
    // v0.8.2: filter out technical AND hidden statuses
    return get().statuses.filter(s => s.is_technical !== 1 && !s.hidden);
  },
  visibleTasks() {
    const techIds = new Set(get().statuses.filter(s => s.is_technical === 1).map(s => s.id));
    return get().tasks.filter(t => !t.archived && !techIds.has(t.status_id));
  },
  allTasks() {
    return get().tasks;
  },

  async init() {
    // Safety-net: если инициализация БД падает — всё равно покажем UI с сообщением
    // об ошибке, чтобы пользователь мог зайти в Настройки → Опасная зона и сбросить БД.
    let initError: string | null = null;
    try {
      await db.initDb();
      get().refresh();
    } catch (e: any) {
      initError = String(e?.message || e || 'Unknown error');
      console.error('[init] DB init failed:', e);
    }
    let map: Record<string, string> = {};
    try {
      const settings = db.all<{ key: string; value: string }>('SELECT * FROM settings');
      settings.forEach(s => map[s.key] = s.value);
    } catch (e) {
      console.error('[init] failed to read settings:', e);
    }
    const theme = (map.theme as ThemeName) || 'light';
    const language = (map.language as Lang) || 'ru';
    const cwRaw = map.column_widths || '{}';
    let columnWidths: Record<string, number> = {};
    try { columnWidths = JSON.parse(cwRaw); } catch {}
    let recentEmojis: string[] = [];
    try {
      const parsed = JSON.parse(map.recent_emojis || '[]');
      if (Array.isArray(parsed)) recentEmojis = parsed.filter((x): x is string => typeof x === 'string').slice(0, 12);
    } catch {}
    const quote = pickQuote(quoteSetFor(theme), language);
    set({
      ready: true,
      language,
      theme,
      statsEnabled: map.stats_enabled !== '0',
      fontSize: parseInt(map.font_size || '14', 10),
      // v0.8.6: вкладка «add» больше не существует — падаем на 'tasks' для старых настроек
      defaultTab: (map.default_tab === 'add' || !map.default_tab) ? 'tasks' : map.default_tab,
      quote,
      columnWidths,
      recentEmojis,
    });
    if (initError) {
      // Сохраняем в возможное поле store для показа в UI; если поля нет — хотя бы в консоль.
      (window as any).__taskflow_init_error = initError;
      console.error('[TaskFlow] init error:', initError);
    }
  },

  refresh() {
    set({
      statuses: db.all<Status>('SELECT * FROM statuses ORDER BY sort_order'),
      tags: db.all<Tag>('SELECT * FROM tags ORDER BY sort_order'),
      tasks: db.all<Task>('SELECT * FROM tasks ORDER BY sort_order'),
    });
  },

  setLanguage(l) {
    db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)', ['language', l]);
    const q = pickQuote(quoteSetFor(get().theme), l);
    set({ language: l, quote: q });
  },
  setTheme(t) {
    db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)', ['theme', t]);
    const q = pickQuote(quoteSetFor(t), get().language);
    set({ theme: t, quote: q });
  },
  setStatsEnabled(v) {
    db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)', ['stats_enabled', v ? '1' : '0']);
    set({ statsEnabled: v });
  },
  setFontSize(n) {
    db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)', ['font_size', String(n)]);
    set({ fontSize: n });
  },
  setDefaultTab(t) {
    db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)', ['default_tab', t]);
    set({ defaultTab: t });
  },

  addTask(p) {
    const now = new Date().toISOString();
    const today = now.slice(0, 10);
    const order = (db.get<{ m: number }>('SELECT COALESCE(MAX(sort_order),0)+1 AS m FROM tasks WHERE status_id=?',
      [p.status_id])?.m) ?? 0;
    const startDate = p.start_date || today;
    const status = get().statuses.find(s => s.id === p.status_id);
    let finishDate = p.finish_date ?? null;
    if (status?.behavior === 'archive' && !finishDate) finishDate = today;
    const r = db.run(
      `INSERT INTO tasks (title, comment, tag_id, status_id, start_date, deadline, finish_date, created_at, updated_at, sort_order, archived)
       VALUES (?,?,?,?,?,?,?,?,?,?,0)`,
      [p.title || '', p.comment || '', p.tag_id ?? null, p.status_id ?? 1,
       startDate, p.deadline ?? null, finishDate, now, now, order]
    );
    get().refresh();
    return r.lastInsertRowid;
  },
  updateTask(id, p) {
    const now = new Date().toISOString();
    const today = now.slice(0, 10);
    const fields: string[] = [];
    const vals: any[] = [];
    let patch: Partial<Task> = { ...p };
    if (p.status_id !== undefined) {
      const newStatus = get().statuses.find(s => s.id === p.status_id);
      const cur = get().tasks.find(t => t.id === id);
      const wasArchive = cur && get().statuses.find(s => s.id === cur.status_id)?.behavior === 'archive';
      const willArchive = newStatus?.behavior === 'archive' && newStatus?.is_technical !== 1;
      if (willArchive && !wasArchive && !cur?.finish_date) {
        patch.finish_date = today;
      } else if (!willArchive && wasArchive) {
        if (p.finish_date === undefined) patch.finish_date = null;
      }
      // Task 6 fix: when restoring a task (changing status), always clear archived flag
      if (newStatus && newStatus.is_technical !== 1) {
        patch.archived = 0;
      }
    }
    Object.entries(patch).forEach(([k, v]) => {
      if (k === 'id') return;
      fields.push(`${k}=?`);
      vals.push(v);
    });
    fields.push('updated_at=?');
    vals.push(now, id);
    db.run(`UPDATE tasks SET ${fields.join(',')} WHERE id=?`, vals);
    get().refresh();
  },
  permanentlyDeleteTask(id) {
    db.run('DELETE FROM tasks WHERE id=?', [id]);
    get().refresh();
  },
  softDeleteTask(id) {
    const now = new Date().toISOString();
    const cur = get().tasks.find(t => t.id === id);
    if (!cur) return;
    const curStatus = get().statuses.find(s => s.id === cur.status_id);
    const deletedId = get().getDeletedStatusId();
    const isArchiveBehavior = curStatus?.behavior === 'archive' && curStatus?.is_technical !== 1;
    if (isArchiveBehavior) {
      db.run(`UPDATE tasks SET archived=1, updated_at=? WHERE id=?`, [now, id]);
    } else {
      const targetId = deletedId ?? cur.status_id;
      db.run(`UPDATE tasks SET status_id=?, archived=1, updated_at=? WHERE id=?`, [targetId, now, id]);
    }
    get().refresh();
  },
  reorderTasks(_statusId, ids) {
    ids.forEach((id, i) => db.run('UPDATE tasks SET sort_order=? WHERE id=?', [i, id]));
    get().refresh();
  },

  addTag(name, color) {
    const order = (db.get<{ m: number }>('SELECT COALESCE(MAX(sort_order),0)+1 AS m FROM tags')?.m) ?? 0;
    const r = db.run('INSERT INTO tags (name, color, sort_order) VALUES (?,?,?)', [name, color, order]);
    get().refresh();
    return r.lastInsertRowid;
  },
  updateTag(id, p) {
    const fields: string[] = [];
    const vals: any[] = [];
    Object.entries(p).forEach(([k, v]) => { if (k === 'id') return; fields.push(`${k}=?`); vals.push(v); });
    vals.push(id);
    db.run(`UPDATE tags SET ${fields.join(',')} WHERE id=?`, vals);
    get().refresh();
  },
  deleteTag(id) {
    db.run('UPDATE tasks SET tag_id=NULL WHERE tag_id=?', [id]);
    db.run('DELETE FROM tags WHERE id=?', [id]);
    get().refresh();
  },

  addStatus(name, color, behavior) {
    const order = (db.get<{ m: number }>('SELECT COALESCE(MAX(sort_order),0)+1 AS m FROM statuses')?.m) ?? 0;
    const r = db.run('INSERT INTO statuses (name, color, behavior, sort_order, is_seed, is_technical, hidden, default_collapsed) VALUES (?,?,?,?,0,0,0,0)',
      [name, color, behavior, order]);
    get().refresh();
    return r.lastInsertRowid;
  },
  updateStatus(id, p) {
    const fields: string[] = [];
    const vals: any[] = [];
    Object.entries(p).forEach(([k, v]) => { if (k === 'id') return; fields.push(`${k}=?`); vals.push(v); });
    vals.push(id);
    db.run(`UPDATE statuses SET ${fields.join(',')} WHERE id=?`, vals);
    get().refresh();
  },
  deleteStatus(id) {
    const status = get().statuses.find(s => s.id === id);
    if (status?.is_technical === 1) return;
    const first = db.get<{ id: number }>('SELECT id FROM statuses WHERE id != ? AND is_technical=0 ORDER BY sort_order LIMIT 1', [id]);
    if (first) db.run('UPDATE tasks SET status_id=? WHERE status_id=?', [first.id, id]);
    db.run('DELETE FROM statuses WHERE id=?', [id]);
    get().refresh();
  },
  reorderStatuses(ids) {
    ids.forEach((id, i) => db.run('UPDATE statuses SET sort_order=? WHERE id=?', [i, id]));
    get().refresh();
  },

  pushToast(text) {
    const id = ++toastId;
    set(s => ({ toasts: [...s.toasts, { id, text }] }));
    setTimeout(() => get().dismissToast(id), 2400);
  },
  dismissToast(id) {
    set(s => ({ toasts: s.toasts.filter(t => t.id !== id) }));
  },

  setColumnWidth(key, w) {
    const next = { ...get().columnWidths, [key]: w };
    set({ columnWidths: next });
    db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)', ['column_widths', JSON.stringify(next)]);
  },

  setTaskStatusFilter(f) {
    set({ taskStatusFilter: f });
  },

  pushRecentEmoji(emoji) {
    if (!emoji) return;
    const cur = get().recentEmojis;
    const next = [emoji, ...cur.filter(e => e !== emoji)].slice(0, 12);
    try {
      db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)', ['recent_emojis', JSON.stringify(next)]);
    } catch (e) {
      console.error('[pushRecentEmoji] failed to persist:', e);
    }
    set({ recentEmojis: next });
  },
}));
