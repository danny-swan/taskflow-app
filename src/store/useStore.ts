// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
import { create } from 'zustand';
import * as db from '../lib/db';
import type { Lang } from '../lib/i18n';
import { detectOverdueEvents, detectOverdueEventForTask } from '../lib/overdue';
import { recordHoldTransition } from '../lib/holdPeriods';
import { todayISO } from '../lib/utils';
import { pickQuote, quoteSetFor } from '../lib/quotes';
import { logger } from '../lib/logger';
import { uuidv7 } from '../lib/uuid';
import { getClientId } from '../lib/clientId';
import { enqueueOutbox } from '../lib/outbox';

export type ThemeName = 'light' | 'dark' | 'akatsuki' | 'konoha' | 'custom';

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
  // v0.9.35-dev.1+: sync-колонки (optional).
  uuid?: string | null;
  deleted_at?: string | null;
  version?: number;
  client_id?: string | null;
  updated_at?: string | null;
}
export interface Tag {
  id: number;
  name: string;
  color: string;
  sort_order: number;
  // v0.9.35-dev.1+: sync-колонки (optional).
  uuid?: string | null;
  deleted_at?: string | null;
  version?: number;
  client_id?: string | null;
  updated_at?: string | null;
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
  // v0.9.35-dev.1+: sync-колонки. Optional в типе, т.к. миграция
  // проставляет их backfill'ом, а refresh() не всегда выбирает SELECT *.
  uuid?: string | null;
  deleted_at?: string | null;
  version?: number;
  client_id?: string | null;
}

// v0.8.13: шаблон задачи — образец, из которого одним кликом создаётся новая задача.
// Хранится в отдельной таблице task_templates (миграция v2).
export interface TaskTemplate {
  id: number;
  name: string;            // пользовательское имя шаблона (показывается в меню/Settings)
  title: string;           // предзаполненный заголовок будущей задачи
  comment: string;         // предзаполненный комментарий (может содержать markdown-чекбоксы)
  status_id: number | null;// статус, в котором создаётся задача (NULL → первый видимый)
  tag_id: number | null;   // тег, если задан (по умолчанию NULL)
  sort_order: number;
  created_at: string;
  updated_at: string;
  // v0.9.35-dev.1+: sync-колонки (optional).
  uuid?: string | null;
  deleted_at?: string | null;
  version?: number;
  client_id?: string | null;
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
  toasts: { id: number; text: string; action?: { label: string; onClick: () => void } }[];
  quote: string;
  columnWidths: Record<string, number>;
  taskStatusFilter: string | null; // for metric chips: 'total' | 'inprogress' | 'paused' | 'done' | null
  recentEmojis: string[];          // v0.8.8: недавние эмодзи для пикера (макс. 12)
  taskTemplates: TaskTemplate[];   // v0.8.13: пользовательские шаблоны задач
  tasksView: 'list' | 'kanban';    // v0.9.0: вид страницы Задачи — список или канбан-доска
  overdueMode: 'calendar' | 'business'; // v0.9.2 (№1): как считать просрочку и остаток дней
  overdueTick: number;             // v0.9.2 (№3): счётчик обновлений таблицы overdue_events (для перерисовки графика)
  autoUpdateEnabled: boolean;      // v0.9.8: автопроверка обновлений при старте (Tauri updater)
  pendingSyncCount: number;        // v0.9.35-dev.3: кол-во записей в sync_outbox, ждущих push'а в облако

  // v0.9.28: автоочистка выполненных задач
  autocleanupEnabled: boolean;           // вкл/выкл автозапуска при старте
  autocleanupMode: 'weekday' | 'age';    // v0.9.30: режим автоочистки
  autocleanupDay: number;                // день недели (0=Вс ... 6=Сб), дефолт 1 (Пн)
  autocleanupMinAgeDays: number;         // возрастной фильтр (дефолт 7)
  autocleanupLastRun: string | null;     // ISO-дата (YYYY-MM-DD) последнего cleanup, или null

  // v0.9.29: кастом-тема — три базовых цвета как #RRGGBB
  customThemeAccent: string;
  customThemeBg: string;
  customThemeText: string;

  // v0.9.31: часовой пояс — 'auto' = локальная TZ системы, либо IANA (Europe/Moscow, UTC, etc.)
  timezone: string;

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
  setTasksView(v: 'list' | 'kanban'): void;
  setOverdueMode(m: 'calendar' | 'business'): void;
  setAutoUpdateEnabled(v: boolean): void;

  // v0.9.28: автоочистка выполненных
  setAutocleanupEnabled(v: boolean): void;
  setAutocleanupMode(m: 'weekday' | 'age'): void;
  setAutocleanupDay(d: number): void;
  setAutocleanupMinAgeDays(n: number): void;
  setTimezone(tz: string): void; // v0.9.31

  runAutoCleanup(opts?: { manual?: boolean; ignoreAge?: boolean }): { count: number; ids: number[] }; // v0.9.30: возвращает id архивированных для Undo
  checkAndRunAutoCleanupOnStartup(): number; // catch-up логика; возвращает кол-во архивированных (0 если не надо)

  // v0.9.29: кастом-тема
  setCustomThemeColor(kind: 'accent' | 'bg' | 'text', hex: string): void;

  addTask(p: Partial<Task>): number;
  updateTask(id: number, p: Partial<Task>): void;
  softDeleteTask(id: number): void;
  permanentlyDeleteTask(id: number): void;
  // v0.9.35-dev.6.10.5: удаление из Статистики с окном отмены (~10 c).
  // Не удаляет сразу — планирует permanentlyDeleteTask через delayMs и показывает
  // тост с кнопкой Undo. Undo в пределах окна отменяет отложенное удаление
  // (задача остаётся нетронутой). По истечении окна выполняется реальное
  // permanentlyDeleteTask (soft-delete + op=delete в outbox).
  deleteTaskWithUndo(id: number, opts: { toastText: string; undoLabel: string; delayMs?: number }): void;
  reorderTasks(statusId: number, ids: number[]): void;

  addTag(name: string, color: string): number;
  updateTag(id: number, p: Partial<Tag>): void;
  deleteTag(id: number): void;

  addStatus(name: string, color: string, behavior: string): number;
  updateStatus(id: number, p: Partial<Status>): void;
  deleteStatus(id: number): void;
  reorderStatuses(ids: number[]): void;

  // v0.8.12: опциональный action для undo и других «я-передумал» жестов.
  // С action живёт дольше (6 с), без action — прежние 2.4 с.
  pushToast(text: string, action?: { label: string; onClick: () => void }): void;
  dismissToast(id: number): void;

  // v0.8.13: API для шаблонов задач.
  // createTaskFromTemplate возвращает id созданной задачи (или null, если шаблон не найден).
  // saveTaskAsTemplate возвращает id созданного шаблона.
  addTemplate(p: { name: string; title?: string; comment?: string; status_id?: number | null; tag_id?: number | null }): number;
  updateTemplate(id: number, p: Partial<TaskTemplate>): void;
  deleteTemplate(id: number): void;
  createTaskFromTemplate(templateId: number): number | null;
  saveTaskAsTemplate(taskId: number, name: string): number | null;

  setColumnWidth(key: string, w: number): void;
  setTaskStatusFilter(f: string | null): void;

  pushRecentEmoji(emoji: string): void;
}

let toastId = 0;

// v0.9.35-dev.6.10.5: отложенные (в пределах окна Undo) permanent-delete'ы.
// Ключ — id задачи, значение — таймер. Модульный уровень: переживает
// перемонтирование страницы Статистики, чтобы окно отмены не срывалось при
// навигации.
const pendingDeletions = new Map<number, ReturnType<typeof setTimeout>>();

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
  taskTemplates: [],
  tasksView: 'list',
  overdueMode: 'calendar',
  overdueTick: 0,
  pendingSyncCount: 0,
  autoUpdateEnabled: true,
  // v0.9.28: автоочистка выполненных — дефолты state (до чтения из БД).
  // v0.9.34: для новых установок autocleanup_enabled='1' пишется в seed таблицы settings.
  autocleanupEnabled: false,
  autocleanupMode: 'weekday',
  autocleanupDay: 1, // v0.9.30: Пн по умолчанию (было Вс)
  autocleanupMinAgeDays: 7,
  autocleanupLastRun: null,

  // v0.9.29: кастом-тема — дефолты совпадают со светлой темой для плавного перехода
  customThemeAccent: '#5B7FB8',
  customThemeBg: '#F7F6F2',
  customThemeText: '#28251D',

  // v0.9.31: часовой пояс — 'auto' по умолчанию (локальная TZ системы)
  timezone: 'auto',

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
      logger.error('db init failed', { error: initError, stack: e?.stack });
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
      // v0.9.0: вид страницы Задачи — список по умолчанию
      tasksView: (map.tasks_view === 'kanban' ? 'kanban' : 'list') as 'list' | 'kanban',
      // v0.9.2 (№1): режим подсчёта просрочки — календарные дни по умолчанию
      overdueMode: (map.overdue_mode === 'business' ? 'business' : 'calendar') as 'calendar' | 'business',
      // v0.9.8: автопроверка обновлений — включена по умолчанию
      autoUpdateEnabled: map.auto_update_enabled !== '0',
      // v0.9.28: автоочистка — opt-out только для новых БД. Старые БД — opt-in.
      // v0.9.34: для новых установок autocleanup_enabled='1' теперь пишется в seed
      // (см. src/lib/db.ts). Здесь только читаем — если ключа нет, значит БД старой версии
      // (<0.9.28) — оставляем OFF (пользователь сам включит, если нужно).
      autocleanupMode: (map.autocleanup_mode === 'age' ? 'age' : 'weekday') as 'weekday' | 'age',
      autocleanupEnabled: map.autocleanup_enabled === '1',
      autocleanupDay: map.autocleanup_day !== undefined ? parseInt(map.autocleanup_day, 10) : 1,
      autocleanupMinAgeDays: map.autocleanup_min_age_days !== undefined ? parseInt(map.autocleanup_min_age_days, 10) : 7,
      autocleanupLastRun: map.autocleanup_last_run || null,
      // v0.9.29: кастом-тема — читаем из БД, fallback на дефолты
      customThemeAccent: (map.custom_theme_accent && /^#[0-9A-Fa-f]{6}$/.test(map.custom_theme_accent)) ? map.custom_theme_accent : '#5B7FB8',
      customThemeBg: (map.custom_theme_bg && /^#[0-9A-Fa-f]{6}$/.test(map.custom_theme_bg)) ? map.custom_theme_bg : '#F7F6F2',
      customThemeText: (map.custom_theme_text && /^#[0-9A-Fa-f]{6}$/.test(map.custom_theme_text)) ? map.custom_theme_text : '#28251D',
      // v0.9.31: часовой пояс (auto/UTC/IANA); валидация через try Intl.
      timezone: (function() {
        const v = map.timezone;
        if (!v || v === 'auto') return 'auto';
        try { new Intl.DateTimeFormat('en-CA', { timeZone: v }); return v; } catch { return 'auto'; }
      })(),
      quote,
      columnWidths,
      recentEmojis,
    });

    // v0.9.34: все autocleanup_* дефолты пишутся в seed для новых установок —
    // бывшая логика «если ключа нет и задач нет → ON» была ошибочна (welcome-задача
    // всегда есть на новой БД). Старые БД (без ключа) остаются OFF.
    if (initError) {
      // Сохраняем в возможное поле store для показа в UI; если поля нет — хотя бы в консоль.
      (window as any).__taskflow_init_error = initError;
      console.error('[TaskFlow] init error:', initError);
    } else {
      logger.info('app ready', {
        statuses: get().statuses.length,
        tags: get().tags.length,
        tasks: get().tasks.length,
      });
    }

    // v0.9.2 (№3): проверяем пересечения дедлайна один раз при старте. Если за время
    // отсутствия пользователя дедлайн у какой-то задачи пересекся впервые — зафиксируем его.
    // Не ломаем init если что-то пошло не так: это вторичная аналитика.
    try {
      const created = detectOverdueEvents(get().tasks, get().statuses, todayISO(get().timezone));
      if (created > 0) {
        console.log(`[overdue] зафиксировано ${created} новых пересечений дедлайна`);
        set(s => ({ overdueTick: s.overdueTick + 1 }));
      }
    } catch (e) {
      console.warn('[overdue] init-scan failed:', e);
    }
  },

  refresh() {
    // v0.8.13: task_templates выбираем в try/catch — таблица появляется после миграции v2.
    // Если миграция ещё не прошла (экзотический крайний случай — сбой в процессе init),
    // приложение всё равно работает — просто без шаблонов.
    //
    // v0.9.35-dev.1: soft delete — везде фильтруем deleted_at IS NULL.
    // После миграции v5 колонка есть везде; на экзотических старых базах без v5
    // запрос упадёт — это ОК, мигратор к этому моменту должен был отработать.
    let taskTemplates: TaskTemplate[] = [];
    try {
      taskTemplates = db.all<TaskTemplate>(
        'SELECT * FROM task_templates WHERE deleted_at IS NULL ORDER BY sort_order, id'
      );
    } catch (e) {
      console.warn('[refresh] task_templates not available yet:', e);
    }
    set({
      statuses: db.all<Status>(
        'SELECT * FROM statuses WHERE deleted_at IS NULL ORDER BY sort_order'
      ),
      tags: db.all<Tag>(
        'SELECT * FROM tags WHERE deleted_at IS NULL ORDER BY sort_order'
      ),
      tasks: db.all<Task>(
        'SELECT * FROM tasks WHERE deleted_at IS NULL ORDER BY sort_order'
      ),
      taskTemplates,
      pendingSyncCount: (() => {
        try {
          const row = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM sync_outbox');
          return row?.n ?? 0;
        } catch {
          // sync_outbox ещё не существует (база старше v6) — вернём 0.
          return 0;
        }
      })(),
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

  // v0.9.29: кастом-тема — обновление одного из трёх базовых цветов
  setCustomThemeColor(kind, hex) {
    // Нормализация: должен быть #RRGGBB. Если краткий формат #RGB — разворачиваем.
    let v = hex.trim();
    if (/^#[0-9A-Fa-f]{3}$/.test(v)) {
      v = '#' + v.slice(1).split('').map(c => c + c).join('');
    }
    if (!/^#[0-9A-Fa-f]{6}$/.test(v)) return; // молча игнорируем невалидные вводы
    const key = kind === 'accent' ? 'custom_theme_accent' : kind === 'bg' ? 'custom_theme_bg' : 'custom_theme_text';
    db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)', [key, v]);
    if (kind === 'accent') set({ customThemeAccent: v });
    else if (kind === 'bg') set({ customThemeBg: v });
    else set({ customThemeText: v });
  },
  setStatsEnabled(v) {
    db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)', ['stats_enabled', v ? '1' : '0']);
    set({ statsEnabled: v });
  },
  setFontSize(n) {
    db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)', ['font_size', String(n)]);
    set({ fontSize: n });
  },
  setOverdueMode(m) {
    db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)', ['overdue_mode', m]);
    set({ overdueMode: m });
  },
  setDefaultTab(t) {
    db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)', ['default_tab', t]);
    set({ defaultTab: t });
  },
  setTasksView(v) {
    db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)', ['tasks_view', v]);
    set({ tasksView: v });
  },
  setAutoUpdateEnabled(v) {
    db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)', ['auto_update_enabled', v ? '1' : '0']);
    set({ autoUpdateEnabled: v });
  },

  // v0.9.28: автоочистка выполненных — сеттеры + 2 активные операции
  setAutocleanupEnabled(v) {
    db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)', ['autocleanup_enabled', v ? '1' : '0']);
    set({ autocleanupEnabled: v });
  },
  // v0.9.30: режим автоочистки — 'weekday' (в опр. день, все вып.) или 'age' (по возрасту, каждый день)
  setAutocleanupMode(m) {
    const clean = m === 'age' ? 'age' : 'weekday';
    db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)', ['autocleanup_mode', clean]);
    set({ autocleanupMode: clean });
  },
  setAutocleanupDay(d) {
    const clamped = Math.max(0, Math.min(6, d));
    db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)', ['autocleanup_day', String(clamped)]);
    set({ autocleanupDay: clamped });
  },
  setAutocleanupMinAgeDays(n) {
    const clamped = Math.max(0, Math.min(90, n));
    db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)', ['autocleanup_min_age_days', String(clamped)]);
    set({ autocleanupMinAgeDays: clamped });
  },
  setTimezone(tz) {
    // v0.9.31: 'auto' или любой валидный IANA TZ. Невалидные — fallback на 'auto'.
    let clean = 'auto';
    if (tz && tz !== 'auto') {
      try { new Intl.DateTimeFormat('en-CA', { timeZone: tz }); clean = tz; } catch { clean = 'auto'; }
    }
    db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)', ['timezone', clean]);
    set({ timezone: clean });
  },
  /**
   * v0.9.30: архивирует выполненные задачи в «Архив».
   *
   * Фильтр по возрасту:
   *  • opts.ignoreAge=true — архивируем ВСЕ выполненные (кнопка «Почистить сейчас» + режим 'weekday' при автозапуске).
   *  • opts.ignoreAge=false/undefined — старше minAgeDays по finish_date (режим 'age').
   *
   * v0.9.30 fix (баг пользователя): НЕ сбрасываем status_id на «Удалено», только archived=1.
   * Так в Статистике задача остаётся со статусом «Выполнено», а не «Удалено».
   * Логика softDeleteTask уже так работает — теперь автоочистка согласована.
   *
   * Возвращает { count, ids } — id ужны для Undo.
   */
  runAutoCleanup(opts) {
    const manual = opts?.manual === true;
    const ignoreAge = opts?.ignoreAge === true;
    const state = get();
    const now = new Date();
    const nowIso = now.toISOString();

    // Фильтруем «архивные» не-technical статусы (типично — только «Выполнено»).
    const doneStatusIds = new Set(
      state.statuses.filter(s => s.behavior === 'archive' && s.is_technical !== 1).map(s => s.id)
    );
    if (doneStatusIds.size === 0) return { count: 0, ids: [] };

    const cutoff = new Date(now.getTime() - state.autocleanupMinAgeDays * 24 * 60 * 60 * 1000);

    const candidates = state.tasks.filter(t => {
      if (!doneStatusIds.has(t.status_id)) return false;
      if (t.archived === 1) return false;
      if (ignoreAge) return true;
      const dateStr = t.finish_date || t.updated_at;
      if (!dateStr) return false;
      const finishTime = new Date(dateStr).getTime();
      if (isNaN(finishTime)) return false;
      return finishTime <= cutoff.getTime();
    });

    if (candidates.length === 0) {
      if (!manual) {
        const today = todayISO(get().timezone);
        db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)', ['autocleanup_last_run', today]);
        set({ autocleanupLastRun: today });
      }
      return { count: 0, ids: [] };
    }

    // v0.9.30: СТАТУС НЕ МЕНЯЕМ — остаётся «Выполнено». Только archived=1.
    const archivedIds: number[] = [];
    for (const t of candidates) {
      db.run('UPDATE tasks SET archived=1, updated_at=? WHERE id=?', [nowIso, t.id]);
      archivedIds.push(t.id);
    }
    logger.info('autocleanup done', { archived: archivedIds.length, manual, ignoreAge, minAgeDays: state.autocleanupMinAgeDays });

    if (!manual) {
      const today = todayISO(get().timezone);
      db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)', ['autocleanup_last_run', today]);
      set({ autocleanupLastRun: today });
    }
    get().refresh();
    return { count: archivedIds.length, ids: archivedIds };
  },
  /**
   * v0.9.30: catch-up логика при старте. Запускается из App.tsx после init().
   *
   * Режимы:
   *   • 'weekday' — в выбранный день недели (или catch-up если прошли) архивируются ВСЕ выполненные.
   *   • 'age'     — проверка каждый день, архивируются выполненные старше minAgeDays.
   */
  checkAndRunAutoCleanupOnStartup() {
    const state = get();
    if (!state.autocleanupEnabled) return 0;

    const now = new Date();
    const today = todayISO(get().timezone);
    if (state.autocleanupLastRun === today) return 0; // уже запускали сегодня

    // v0.9.30: режим 'age' — просто запускаем каждый день, фильтр по возрасту.
    if (state.autocleanupMode === 'age') {
      return get().runAutoCleanup({ manual: false, ignoreAge: false }).count;
    }

    // Режим 'weekday'. Если last_run нет — срабатываем если сегодня целевой день.
    if (!state.autocleanupLastRun) {
      if (now.getDay() === state.autocleanupDay) {
        return get().runAutoCleanup({ manual: false, ignoreAge: true }).count;
      }
      return 0;
    }

    // Есть last_run. Проверяем, прошла ли target-дата в интервале (last_run+1, today].
    const lastRunDate = new Date(state.autocleanupLastRun + 'T00:00:00');
    const daysSince = Math.floor((now.getTime() - lastRunDate.getTime()) / (24 * 60 * 60 * 1000));
    if (daysSince >= 7) {
      return get().runAutoCleanup({ manual: false, ignoreAge: true }).count;
    }
    for (let i = 1; i <= daysSince; i++) {
      const d = new Date(lastRunDate.getTime() + i * 24 * 60 * 60 * 1000);
      if (d.getDay() === state.autocleanupDay) {
        return get().runAutoCleanup({ manual: false, ignoreAge: true }).count;
      }
    }
    return 0;
  },

  addTask(p) {
    const now = new Date().toISOString();
    const today = todayISO(get().timezone);
    const order = (db.get<{ m: number }>('SELECT COALESCE(MAX(sort_order),0)+1 AS m FROM tasks WHERE status_id=?',
      [p.status_id])?.m) ?? 0;
    const startDate = p.start_date || today;
    const status = get().statuses.find(s => s.id === p.status_id);
    let finishDate = p.finish_date ?? null;
    if (status?.behavior === 'archive' && !finishDate) finishDate = today;
    // v0.9.35-dev.2: sync-колонки на INSERT'е.
    const rowUuid = uuidv7();
    const clientId = getClientId();
    const r = db.run(
      `INSERT INTO tasks (title, comment, tag_id, status_id, start_date, deadline, finish_date, created_at, updated_at, sort_order, archived, uuid, client_id, version)
       VALUES (?,?,?,?,?,?,?,?,?,?,0,?,?,1)`,
      [p.title || '', p.comment || '', p.tag_id ?? null, p.status_id ?? 1,
       startDate, p.deadline ?? null, finishDate, now, now, order, rowUuid, clientId]
    );
    enqueueOutbox('tasks', rowUuid, 'upsert');
    // Задачу могли создать сразу в статусе «Приостановлено» — открываем интервал.
    recordHoldTransition(r.lastInsertRowid as number, null, p.status_id, get().statuses);
    get().refresh();

    // v0.9.2 (№3): если создали задачу с уже прошедшим дедлайном — тоже фиксируем как пересечение.
    try {
      const fresh = get().tasks.find(t => t.id === r.lastInsertRowid);
      if (fresh && detectOverdueEventForTask(fresh, get().statuses, todayISO(get().timezone))) {
        set(s => ({ overdueTick: s.overdueTick + 1 }));
      }
    } catch (e) { console.warn('[overdue] detect after addTask failed:', e); }

    return r.lastInsertRowid;
  },
  updateTask(id, p) {
    const now = new Date().toISOString();
    const today = todayISO(get().timezone);
    const fields: string[] = [];
    const vals: any[] = [];
    let patch: Partial<Task> = { ...p };
    // Запоминаем прежний статус до UPDATE — нужен для учёта холд-интервалов.
    const prevStatusId = get().tasks.find(t => t.id === id)?.status_id ?? null;
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
    vals.push(now);
    // v0.9.35-dev.2: version++, чтобы sync-слой видел, что строка изменилась.
    fields.push('version=version+1');
    vals.push(id);
    db.run(`UPDATE tasks SET ${fields.join(',')} WHERE id=?`, vals);
    // Outbox enqueue за uuid’ом — берём текущий из строки (мог быть NULL
    // для старых строк — enqueueOutbox тихо пропустит).
    const row = db.get<{ uuid: string | null }>('SELECT uuid FROM tasks WHERE id=?', [id]);
    enqueueOutbox('tasks', row?.uuid, 'upsert');

    // Холд-интервалы: фиксируем вход/выход из статуса «Приостановлено».
    if (p.status_id !== undefined && p.status_id !== prevStatusId) {
      recordHoldTransition(id, prevStatusId, p.status_id, get().statuses);
    }
    get().refresh();

    // v0.9.2 (№3): если изменился дедлайн или статус — перепроверяем пересечение
    // дедлайна. Сдвинули вперёд и потом опять в прошлое — это новое событие.
    if (p.deadline !== undefined || p.status_id !== undefined) {
      try {
        const fresh = get().tasks.find(t => t.id === id);
        if (fresh && detectOverdueEventForTask(fresh, get().statuses, todayISO(get().timezone))) {
          set(s => ({ overdueTick: s.overdueTick + 1 }));
        }
      } catch (e) { console.warn('[overdue] detect after updateTask failed:', e); }
    }
  },
  permanentlyDeleteTask(id) {
    // v0.9.35-dev.1: soft delete. Физически строка остаётся — это нужно для
    // корректного sync (другие устройства должны увидеть deleted_at
    // и скрыть у себя, а не считать «нету — стало быть не было и вовсе»).
    // Полное hard-delete делает сервисный воркер через N дней (не в этой версии).
    const now = new Date().toISOString();
    // v0.9.35-dev.2: enqueue до UPDATE — чтобы взять uuid пока строка ещё видима.
    const row = db.get<{ uuid: string | null }>('SELECT uuid FROM tasks WHERE id=?', [id]);
    db.run(
      'UPDATE tasks SET deleted_at=?, updated_at=?, version=version+1 WHERE id=?',
      [now, now, id]
    );
    enqueueOutbox('tasks', row?.uuid, 'delete');
    get().refresh();
  },
  deleteTaskWithUndo(id, opts) {
    const delay = opts.delayMs ?? 10000;
    // Если для этой задачи уже запланировано удаление — сбрасываем прежний таймер.
    const existing = pendingDeletions.get(id);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      pendingDeletions.delete(id);
      get().permanentlyDeleteTask(id);
    }, delay);
    pendingDeletions.set(id, timer);
    get().pushToast(opts.toastText, {
      label: opts.undoLabel,
      onClick: () => {
        const t = pendingDeletions.get(id);
        if (t) {
          clearTimeout(t);
          pendingDeletions.delete(id);
        }
      },
    });
  },
  softDeleteTask(id) {
    const now = new Date().toISOString();
    const cur = get().tasks.find(t => t.id === id);
    if (!cur) return;
    const curStatus = get().statuses.find(s => s.id === cur.status_id);
    const deletedId = get().getDeletedStatusId();
    const isArchiveBehavior = curStatus?.behavior === 'archive' && curStatus?.is_technical !== 1;
    // v0.9.35-dev.2: version++ + enqueue в sync-варианте (это не удаление,
    // а обычное изменение archived/status_id — op = 'upsert').
    if (isArchiveBehavior) {
      db.run(
        `UPDATE tasks SET archived=1, updated_at=?, version=version+1 WHERE id=?`,
        [now, id],
      );
    } else {
      const targetId = deletedId ?? cur.status_id;
      db.run(
        `UPDATE tasks SET status_id=?, archived=1, updated_at=?, version=version+1 WHERE id=?`,
        [targetId, now, id],
      );
      // Ушли из «Приостановлено» в «Удалено» — закрываем открытый холд-интервал.
      recordHoldTransition(id, cur.status_id, targetId, get().statuses);
    }
    enqueueOutbox('tasks', cur.uuid ?? null, 'upsert');
    get().refresh();
  },
  reorderTasks(_statusId, ids) {
    // v0.9.35-dev.2: reorder — тоже мутация. Бампаем version + updated_at,
    // enqueue каждую изменённую строку. Случай массовый (drag'n'drop всей
    // колонки) — outbox dedup по uuid гарантирует одну запись на задачу.
    const now = new Date().toISOString();
    ids.forEach((id, i) => {
      db.run(
        'UPDATE tasks SET sort_order=?, updated_at=?, version=version+1 WHERE id=?',
        [i, now, id],
      );
      const row = db.get<{ uuid: string | null }>('SELECT uuid FROM tasks WHERE id=?', [id]);
      enqueueOutbox('tasks', row?.uuid, 'upsert');
    });
    get().refresh();
  },

  addTag(name, color) {
    const order = (db.get<{ m: number }>('SELECT COALESCE(MAX(sort_order),0)+1 AS m FROM tags')?.m) ?? 0;
    // v0.9.35-dev.2: sync-колонки.
    const rowUuid = uuidv7();
    const clientId = getClientId();
    const now = new Date().toISOString();
    const r = db.run(
      'INSERT INTO tags (name, color, sort_order, uuid, client_id, version, updated_at) VALUES (?,?,?,?,?,1,?)',
      [name, color, order, rowUuid, clientId, now],
    );
    enqueueOutbox('tags', rowUuid, 'upsert');
    get().refresh();
    return r.lastInsertRowid;
  },
  updateTag(id, p) {
    const fields: string[] = [];
    const vals: any[] = [];
    Object.entries(p).forEach(([k, v]) => { if (k === 'id') return; fields.push(`${k}=?`); vals.push(v); });
    // v0.9.35-dev.2: version++ + updated_at.
    const now = new Date().toISOString();
    fields.push('updated_at=?');
    vals.push(now);
    fields.push('version=version+1');
    vals.push(id);
    db.run(`UPDATE tags SET ${fields.join(',')} WHERE id=?`, vals);
    const row = db.get<{ uuid: string | null }>('SELECT uuid FROM tags WHERE id=?', [id]);
    enqueueOutbox('tags', row?.uuid, 'upsert');
    get().refresh();
  },
  deleteTag(id) {
    // v0.9.35-dev.1: soft delete. Сначала отвязываем тег от всех задач
    // (бампая version, чтобы sync подхватил это изменение), затем тег помечаем
    // как удалённый.
    const now = new Date().toISOString();
    // v0.9.35-dev.2: взять uuid тега до удаления + аффектед задачи.
    const tagRow = db.get<{ uuid: string | null }>('SELECT uuid FROM tags WHERE id=?', [id]);
    const affectedTasks = db.all<{ uuid: string | null }>(
      'SELECT uuid FROM tasks WHERE tag_id=? AND deleted_at IS NULL',
      [id],
    );
    db.run(
      'UPDATE tasks SET tag_id=NULL, updated_at=?, version=version+1 WHERE tag_id=?',
      [now, id]
    );
    db.run(
      'UPDATE tags SET deleted_at=?, updated_at=?, version=version+1 WHERE id=?',
      [now, now, id]
    );
    enqueueOutbox('tags', tagRow?.uuid, 'delete');
    for (const t of affectedTasks) enqueueOutbox('tasks', t.uuid, 'upsert');
    get().refresh();
  },

  addStatus(name, color, behavior) {
    // v0.9.35-dev.2: uuid/client_id/version=1 + enqueue в sync_outbox.
    const order = (db.get<{ m: number }>('SELECT COALESCE(MAX(sort_order),0)+1 AS m FROM statuses')?.m) ?? 0;
    const now = new Date().toISOString();
    const rowUuid = uuidv7();
    const clientId = getClientId();
    const r = db.run(
      `INSERT INTO statuses (name, color, behavior, sort_order, is_seed, is_technical, hidden, default_collapsed,
                             uuid, client_id, version, updated_at)
       VALUES (?,?,?,?,0,0,0,0,?,?,1,?)`,
      [name, color, behavior, order, rowUuid, clientId, now]
    );
    enqueueOutbox('statuses', rowUuid, 'upsert');
    get().refresh();
    return r.lastInsertRowid;
  },
  updateStatus(id, p) {
    const fields: string[] = [];
    const vals: any[] = [];
    Object.entries(p).forEach(([k, v]) => { if (k === 'id') return; fields.push(`${k}=?`); vals.push(v); });
    // v0.9.35-dev.2: автобамп version + updated_at + enqueue.
    const now = new Date().toISOString();
    fields.push('updated_at=?', 'version=COALESCE(version,0)+1');
    vals.push(now, id);
    db.run(`UPDATE statuses SET ${fields.join(',')} WHERE id=?`, vals);
    const fresh = db.get<{ uuid: string | null }>('SELECT uuid FROM statuses WHERE id=?', [id]);
    enqueueOutbox('statuses', fresh?.uuid ?? null, 'upsert');
    get().refresh();
  },
  deleteStatus(id) {
    const status = get().statuses.find(s => s.id === id);
    if (status?.is_technical === 1) return;
    // v0.8.11: «Выполнено» (единственный не-technical статус с behavior='archive') системный и неудаляемый:
    // без него сломается кнопка-галочка «Выполнить» на карточке (не найдёт куда переместить).
    if (status?.behavior === 'archive') return;
    // v0.9.35-dev.1: soft delete. Переливаем задачи на первый видимый статус
    // (также с бампом version), сам статус помечаем удалённым.
    // v0.9.35-dev.2: enqueue статуса + всех аффектед задач ДО UPDATE (собираем uuid'ы).
    const now = new Date().toISOString();
    const statusRow = db.get<{ uuid: string | null }>('SELECT uuid FROM statuses WHERE id=?', [id]);
    const first = db.get<{ id: number }>(
      'SELECT id FROM statuses WHERE id != ? AND is_technical=0 AND deleted_at IS NULL ORDER BY sort_order LIMIT 1',
      [id]
    );
    let affectedTaskUuids: string[] = [];
    if (first) {
      affectedTaskUuids = db.all<{ uuid: string | null }>(
        'SELECT uuid FROM tasks WHERE status_id=? AND deleted_at IS NULL',
        [id]
      ).map(r => r.uuid).filter((u): u is string => !!u);
      db.run(
        'UPDATE tasks SET status_id=?, updated_at=?, version=version+1 WHERE status_id=?',
        [first.id, now, id]
      );
    }
    db.run(
      'UPDATE statuses SET deleted_at=?, updated_at=?, version=version+1 WHERE id=?',
      [now, now, id]
    );
    enqueueOutbox('statuses', statusRow?.uuid ?? null, 'delete');
    affectedTaskUuids.forEach(u => enqueueOutbox('tasks', u, 'upsert'));
    get().refresh();
  },
  reorderStatuses(ids) {
    // v0.9.35-dev.2: reorder меняет sort_order → бампим version + enqueue.
    const now = new Date().toISOString();
    ids.forEach((id, i) => {
      db.run(
        'UPDATE statuses SET sort_order=?, updated_at=?, version=COALESCE(version,0)+1 WHERE id=?',
        [i, now, id]
      );
      const row = db.get<{ uuid: string | null }>('SELECT uuid FROM statuses WHERE id=?', [id]);
      enqueueOutbox('statuses', row?.uuid ?? null, 'upsert');
    });
    get().refresh();
  },

  pushToast(text, action) {
    const id = ++toastId;
    set(s => ({ toasts: [...s.toasts, { id, text, action }] }));
    // v0.9.30: с action (undo) — 10 сек (было 6). Без action — прежние 2.4 с.
    setTimeout(() => get().dismissToast(id), action ? 10000 : 2400);
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

  // ── v0.8.13 templates API ──

  addTemplate(p) {
    // v0.9.35-dev.2: uuid/client_id/version=1 + enqueue.
    const now = new Date().toISOString();
    const order = (db.get<{ m: number }>('SELECT COALESCE(MAX(sort_order),0)+1 AS m FROM task_templates')?.m) ?? 0;
    const rowUuid = uuidv7();
    const clientId = getClientId();
    const r = db.run(
      `INSERT INTO task_templates (name, title, comment, status_id, tag_id, sort_order, created_at, updated_at,
                                   uuid, client_id, version)
       VALUES (?,?,?,?,?,?,?,?,?,?,1)`,
      [p.name, p.title ?? '', p.comment ?? '', p.status_id ?? null, p.tag_id ?? null, order, now, now, rowUuid, clientId]
    );
    enqueueOutbox('task_templates', rowUuid, 'upsert');
    get().refresh();
    return r.lastInsertRowid;
  },

  updateTemplate(id, p) {
    const now = new Date().toISOString();
    const fields: string[] = [];
    const vals: any[] = [];
    Object.entries(p).forEach(([k, v]) => {
      if (k === 'id' || k === 'created_at') return;
      fields.push(`${k}=?`);
      vals.push(v as any);
    });
    if (!fields.length) return;
    // v0.9.35-dev.2: автобамп version + updated_at + enqueue.
    fields.push('updated_at=?', 'version=COALESCE(version,0)+1');
    vals.push(now, id);
    db.run(`UPDATE task_templates SET ${fields.join(',')} WHERE id=?`, vals);
    const fresh = db.get<{ uuid: string | null }>('SELECT uuid FROM task_templates WHERE id=?', [id]);
    enqueueOutbox('task_templates', fresh?.uuid ?? null, 'upsert');
    get().refresh();
  },

  deleteTemplate(id) {
    // v0.9.35-dev.1: soft delete.
    // v0.9.35-dev.2: enqueue ДО UPDATE (собираем uuid пока строка видима).
    const now = new Date().toISOString();
    const row = db.get<{ uuid: string | null }>('SELECT uuid FROM task_templates WHERE id=?', [id]);
    db.run(
      'UPDATE task_templates SET deleted_at=?, updated_at=?, version=version+1 WHERE id=?',
      [now, now, id]
    );
    enqueueOutbox('task_templates', row?.uuid ?? null, 'delete');
    get().refresh();
  },

  createTaskFromTemplate(templateId) {
    const tpl = get().taskTemplates.find(t => t.id === templateId);
    if (!tpl) return null;
    // Статус выбираем в порядке:
    // 1) сохранённый в шаблоне status_id (если этот статус всё ещё видимый)
    // 2) статус с именем «Взять в работу» (исторический default для сидового
    //    шаблона — в 0.8.16 и раньше сидовый status_id мог уже не совпадать
    //    с реальным id в БД пользователя после импортов/миграций)
    // 3) первый видимый не-технический статус
    const visible = get().visibleStatuses();
    const fromSaved = tpl.status_id != null ? visible.find(s => s.id === tpl.status_id) : undefined;
    const byName = !fromSaved ? visible.find(s => s.name === 'Взять в работу') : undefined;
    const statusId = fromSaved?.id ?? byName?.id ?? visible[0]?.id ?? 1;
    const tagExists = tpl.tag_id != null && get().tags.find(t => t.id === tpl.tag_id);
    return get().addTask({
      title: tpl.title || '',
      comment: tpl.comment || '',
      status_id: statusId,
      tag_id: tagExists ? tpl.tag_id : null,
    });
  },

  saveTaskAsTemplate(taskId, name) {
    const task = get().tasks.find(t => t.id === taskId);
    if (!task) return null;
    return get().addTemplate({
      name: name || `Шаблон от ${new Date().toLocaleDateString()}`,
      title: task.title,
      comment: task.comment,
      status_id: task.status_id,
      tag_id: task.tag_id,
    });
  },
}));
