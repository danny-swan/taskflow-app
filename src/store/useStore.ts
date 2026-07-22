// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
import { create } from 'zustand';
import * as db from '../lib/db';
import type { Lang } from '../lib/i18n';
import { tr } from '../lib/i18n';
import { computeWorkspaceId, LOCAL_WS_ID } from '../lib/sync/workspace';
import { detectOverdueEvents, detectOverdueEventForTask } from '../lib/overdue';
import { recordHoldTransition } from '../lib/holdPeriods';
import { todayISO } from '../lib/utils';
import { pickQuote, quoteSetFor } from '../lib/quotes';
import { logger } from '../lib/logger';
import { uuidv7 } from '../lib/uuid';
import { getClientId } from '../lib/clientId';
import { enqueueOutbox } from '../lib/outbox';
import { SEED_STATUSES } from '../lib/seedData';

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
  // Wave A (workspaces): к какому пространству относится строка.
  workspace_id?: string | null;
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
  // Wave A (workspaces): к какому пространству относится строка.
  workspace_id?: string | null;
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
  // Wave A (workspaces): к какому пространству относится строка.
  workspace_id?: string | null;
}

/**
 * Wave A (workspaces): пространство. Локальное зеркало таблицы `workspaces`.
 * `id` — серверный ws-id (`ws_<uid>` для personal, `ws_local` для local-only).
 */
export interface Workspace {
  id: string;                       // = workspaces.uuid (серверный ws-id)
  name: string;
  kind: 'personal' | 'shared' | string;
  owner_id: string | null;
  sort_order: number;
}

/**
 * Wave A (workspaces): участник пространства. Локальное зеркало таблицы
 * `workspace_members`. `id` — серверный uuid строки членства; `user_id` —
 * uuid пользователя; `role` — owner/editor/viewer.
 */
export interface WorkspaceMember {
  id: string;                       // = workspace_members.uuid (серверный id)
  workspace_id: string;
  user_id: string | null;
  role: 'owner' | 'editor' | 'viewer' | string;
  invited_by: string | null;
  joined_at: string | null;
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
  // Wave A (workspaces): к какому пространству относится строка.
  workspace_id?: string | null;
}

interface State {
  ready: boolean;
  statuses: Status[];        // all statuses incl technical (for stats)
  tags: Tag[];
  tasks: Task[];             // all tasks incl archived/deleted (full set)
  // Wave A (workspaces): текущее пространство + список доступных пространств.
  // Persist'ится в settings.current_workspace_id. Все страницы читают данные
  // через ws-scoped хуки (useCurrentWorkspace*), фильтруя по currentWorkspaceId.
  currentWorkspaceId: string | null;
  workspaces: Workspace[];
  // Wave A (workspaces, PR-4): участники всех известных пространств + uuid
  // привязанного пользователя (settings.bound_user_id). Нужны ролевым хукам
  // (useCurrentWorkspaceRole) и вкладке «Участники».
  workspaceMembers: WorkspaceMember[];
  boundUserId: string | null;
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

  // Wave A (workspaces): управление текущим пространством.
  setWorkspaces(list: Workspace[]): void;
  loadWorkspaces(): void;                 // перечитать список из локальной БД + выбрать дефолт
  loadWorkspaceMembers(): void;           // перечитать участников из локальной БД
  reloadAccountBinding(): void;           // Fix 2: перечитать bound_user_id + ws/members из БД
  switchWorkspace(id: string): void;      // сменить текущее ws (persist + refresh + resync)

  // Wave A (workspaces, PR-4): CRUD пространств. Все — локальная запись в SQLite
  // + enqueueOutbox для последующего push'а в облако.
  createWorkspace(name: string, kind: 'personal' | 'shared'): string; // → id нового ws
  renameWorkspace(id: string, name: string): void;                     // owner-only (UI-гейт)
  deleteWorkspace(id: string): void;                                   // soft-delete + switch на personal

  // Управление участниками текущего (shared) пространства.
  addWorkspaceMember(userId: string, role: 'editor' | 'viewer'): void;
  updateWorkspaceMemberRole(memberId: string, role: 'owner' | 'editor' | 'viewer'): void;
  removeWorkspaceMember(memberId: string): void;

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

// ── Wave A (workspaces): чтение пространств из локальной БД ──────────────────

/**
 * Прочитать список активных пространств из локальной таблицы `workspaces`.
 *
 * Bug #1 (фантомные пространства): список строится ТОЛЬКО из пространств, где у
 * текущего пользователя (settings.bound_user_id) есть живое членство в
 * `workspace_members` (deleted_at IS NULL). Иначе в сайдбар просачиваются
 * чужие personal-ws и остатки прошлых аккаунтов, осевшие в локальном SQLite.
 *
 * Скоуп строится по МЕМБЕРШИПУ (а не owner_id) — иначе поломается shared-сценарий,
 * где участник видит чужой workspace, в котором он состоит.
 *
 * Local-only база (bound_user_id ещё нет — вход не выполнялся): фильтр не
 * применяем, показываем всё (одна БД = один локальный пользователь).
 */
function readWorkspacesFromDb(): Workspace[] {
  try {
    const boundUserId = (readSetting('bound_user_id') || '').trim() || null;
    const rows = boundUserId
      ? db.all<{
          uuid: string | null; name: string; kind: string;
          owner_id: string | null; sort_order: number;
        }>(
          `SELECT w.uuid, w.name, w.kind, w.owner_id, w.sort_order
             FROM workspaces w
            WHERE w.uuid IS NOT NULL AND w.deleted_at IS NULL
              AND EXISTS (
                SELECT 1 FROM workspace_members m
                 WHERE m.workspace_id = w.uuid
                   AND m.user_id = ?
                   AND m.deleted_at IS NULL
              )
            ORDER BY w.sort_order, w.id`,
          [boundUserId],
        )
      : db.all<{
          uuid: string | null; name: string; kind: string;
          owner_id: string | null; sort_order: number;
        }>(
          `SELECT uuid, name, kind, owner_id, sort_order
             FROM workspaces
            WHERE uuid IS NOT NULL AND deleted_at IS NULL
            ORDER BY sort_order, id`,
        );
    const list: Workspace[] = rows
      .filter(r => !!r.uuid)
      .map(r => ({
        id: r.uuid as string,
        name: r.name,
        kind: r.kind,
        owner_id: r.owner_id ?? null,
        sort_order: r.sort_order ?? 0,
      }));
    // Регрессия D/E: personal-ws (и ws_local) обязаны быть в сайдбаре ВСЕГДА —
    // даже если строка членства ещё не подтянулась (до первого pull, после
    // clearUserData, при рассинхроне bound_user_id). Иначе EXISTS-фильтр выше
    // отсеивает personal и экран пуст.
    if (boundUserId) {
      ensurePersonalInList(list, boundUserId);
    }
    return list;
  } catch {
    // Таблица workspaces отсутствует на базе до v11 — не критично.
    return [];
  }
}

/**
 * Гарантировать, что в списке пространств присутствует personal-ws текущего
 * пользователя (`ws_<uid>`) и, если он локально есть, `ws_local`. Если строки
 * ws нет вовсе — синтезируем минимальный personal, чтобы переключателю всегда
 * было куда встать (writer'ы всё равно создадут строку при первом изменении).
 */
function ensurePersonalInList(list: Workspace[], boundUserId: string): void {
  const addByIdIfMissing = (wsId: string, synthesize: boolean) => {
    if (list.some(w => w.id === wsId)) return;
    let row: { uuid: string | null; name: string; kind: string; owner_id: string | null; sort_order: number } | null | undefined;
    try {
      row = db.get(
        'SELECT uuid, name, kind, owner_id, sort_order FROM workspaces WHERE uuid=? AND deleted_at IS NULL',
        [wsId],
      );
    } catch { /* таблицы может не быть до v11 */ }
    if (row?.uuid) {
      list.unshift({
        id: row.uuid,
        name: row.name,
        kind: row.kind,
        owner_id: row.owner_id ?? null,
        sort_order: row.sort_order ?? 0,
      });
    } else if (synthesize) {
      logger.warn('[useStore] personal workspace row missing — synthesizing sidebar entry:', wsId);
      list.unshift({ id: wsId, name: 'Мои задачи', kind: 'personal', owner_id: boundUserId, sort_order: 0 });
    }
  };
  addByIdIfMissing(computeWorkspaceId(boundUserId), true);
  addByIdIfMissing(LOCAL_WS_ID, false);
}

/** Прочитать участников всех пространств из локальной таблицы `workspace_members`. */
function readMembersFromDb(): WorkspaceMember[] {
  try {
    const rows = db.all<{
      uuid: string | null; workspace_id: string; user_id: string | null;
      role: string; invited_by: string | null; joined_at: string | null;
    }>(
      `SELECT uuid, workspace_id, user_id, role, invited_by, joined_at
         FROM workspace_members
        WHERE deleted_at IS NULL
        ORDER BY joined_at, id`,
    );
    return rows
      .filter(r => !!r.uuid)
      .map(r => ({
        id: r.uuid as string,
        workspace_id: r.workspace_id,
        user_id: r.user_id ?? null,
        role: r.role,
        invited_by: r.invited_by ?? null,
        joined_at: r.joined_at ?? null,
      }));
  } catch {
    // Таблицы нет на базе до v11 — не критично.
    return [];
  }
}

/** Прочитать один ключ из settings (или null). */
function readSetting(key: string): string | null {
  try {
    return db.get<{ value: string }>('SELECT value FROM settings WHERE key=?', [key])?.value ?? null;
  } catch {
    return null;
  }
}

/**
 * Выбрать пространство по умолчанию: personal (settings.personal_workspace_id),
 * иначе первое personal, иначе первое из списка, иначе null.
 */
function pickDefaultWorkspaceId(list: Workspace[]): string | null {
  const personalId = readSetting('personal_workspace_id');
  if (personalId && list.some(w => w.id === personalId)) return personalId;
  const firstPersonal = list.find(w => w.kind === 'personal');
  if (firstPersonal) return firstPersonal.id;
  return list[0]?.id ?? null;
}

/**
 * ws-id для НОВОЙ строки: текущее пространство стора, иначе persist'нутый
 * current_workspace_id, иначе personal_workspace_id. Гарантирует, что новые
 * задачи/статусы/теги/шаблоны не создаются с NULL workspace_id (иначе они
 * выпадут из ws-scoped выборок и не пройдут серверный NOT NULL).
 */
function resolveWriteWorkspaceId(current: string | null): string | null {
  return current || readSetting('current_workspace_id') || readSetting('personal_workspace_id');
}

/**
 * Bug #4: сев эталонных статусов при создании нового пространства.
 *
 * Раньше новые ws создавались пустыми — ни статусов, ни колонок на доске, задачи
 * некуда положить. Сеем те же 7 эталонных статусов (SEED_STATUSES, единый
 * источник правды из lib/seedData), что и при первичной инициализации
 * personal-ws, но с workspace_id нового пространства. Статусы создаются на
 * клиенте с UUIDv7 + client_id и ставятся в outbox → уходят в облако штатным
 * push по PUSH_ORDER (та же модель, что и addStatus). Для shared-участника
 * статусы приезжают pull'ом от owner — этот путь не трогаем.
 *
 * Идемпотентно: если в ws уже есть живые статусы — no-op (защита от повторного
 * сева при ретраях/pull). Возвращает число засеянных статусов.
 */
function seedDefaultStatuses(wsId: string): number {
  const existing =
    db.get<{ c: number }>(
      'SELECT COUNT(*) AS c FROM statuses WHERE workspace_id=? AND deleted_at IS NULL',
      [wsId],
    )?.c ?? 0;
  if (existing > 0) return 0;

  const now = new Date().toISOString();
  const clientId = getClientId();
  for (let i = 0; i < SEED_STATUSES.length; i++) {
    const s = SEED_STATUSES[i];
    const rowUuid = uuidv7();
    db.run(
      `INSERT INTO statuses (name, color, behavior, sort_order, is_seed, is_technical, hidden, default_collapsed,
                             uuid, client_id, version, updated_at, workspace_id)
       VALUES (?,?,?,?,1,?,?,?,?,?,1,?,?)`,
      [s.name, s.color, s.behavior, i, s.is_technical, s.hidden, s.default_collapsed,
       rowUuid, clientId, now, wsId],
    );
    enqueueOutbox('statuses', rowUuid, 'upsert');
  }
  return SEED_STATUSES.length;
}

/**
 * overdue_mode ТЕКУЩЕГО пространства из workspace_settings.
 * Приоритет: workspace_settings(ws,'overdue_mode') → глобальный settings.overdue_mode
 * (легаси-фолбэк) → 'calendar'.
 */
function readOverdueModeForWs(wsId: string | null): 'calendar' | 'business' {
  if (wsId) {
    try {
      const row = db.get<{ value: string | null }>(
        `SELECT value FROM workspace_settings
          WHERE workspace_id=? AND key='overdue_mode' AND deleted_at IS NULL`,
        [wsId],
      );
      if (row?.value === 'business') return 'business';
      if (row?.value === 'calendar') return 'calendar';
    } catch {
      // Таблица отсутствует (база до v11) — падаем на легаси-ключ ниже.
    }
  }
  return readSetting('overdue_mode') === 'business' ? 'business' : 'calendar';
}

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
  currentWorkspaceId: null,
  workspaces: [],
  workspaceMembers: [],
  boundUserId: null,
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

    // Wave A (workspaces): список пространств + текущее пространство.
    // Если сохранённый current_workspace_id пуст или указывает на несуществующее
    // пространство — падаем на personal-пространство по умолчанию.
    const workspaces = readWorkspacesFromDb();
    const workspaceMembers = readMembersFromDb();
    const boundUserId = (map.bound_user_id || '').trim() || null;
    const savedWsId = (map.current_workspace_id || '').trim() || null;
    const currentWorkspaceId =
      savedWsId && workspaces.some(w => w.id === savedWsId)
        ? savedWsId
        : pickDefaultWorkspaceId(workspaces);
    // Синхронизируем persist, если дефолт отличается от сохранённого.
    if (currentWorkspaceId && currentWorkspaceId !== savedWsId) {
      try {
        db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)', ['current_workspace_id', currentWorkspaceId]);
      } catch (e) { console.warn('[init] persist current_workspace_id failed:', e); }
    }

    set({
      ready: true,
      currentWorkspaceId,
      workspaces,
      workspaceMembers,
      boundUserId,
      language,
      theme,
      statsEnabled: map.stats_enabled !== '0',
      fontSize: parseInt(map.font_size || '14', 10),
      // v0.8.6: вкладка «add» больше не существует — падаем на 'tasks' для старых настроек
      defaultTab: (map.default_tab === 'add' || !map.default_tab) ? 'tasks' : map.default_tab,
      // v0.9.0: вид страницы Задачи — список по умолчанию
      tasksView: (map.tasks_view === 'kanban' ? 'kanban' : 'list') as 'list' | 'kanban',
      // v0.9.2 (№1): режим подсчёта просрочки — календарные дни по умолчанию.
      // Wave A: берём режим ТЕКУЩЕГО пространства из workspace_settings
      // (фолбэк — легаси settings.overdue_mode → 'calendar').
      overdueMode: readOverdueModeForWs(currentWorkspaceId),
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

  // ── Wave A (workspaces) ──────────────────────────────────────────────────

  setWorkspaces(list) {
    set({ workspaces: list });
    // Если текущее пространство исчезло из набора — выбираем дефолт.
    const cur = get().currentWorkspaceId;
    if (!cur || !list.some(w => w.id === cur)) {
      const next = pickDefaultWorkspaceId(list);
      if (next && next !== cur) {
        set({ currentWorkspaceId: next, overdueMode: readOverdueModeForWs(next) });
        try {
          db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)', ['current_workspace_id', next]);
        } catch (e) { console.warn('[setWorkspaces] persist current_workspace_id failed:', e); }
      }
    }
  },

  loadWorkspaces() {
    const list = readWorkspacesFromDb();
    // current_workspace_id в settings — источник истины после логина/смены
    // аккаунта (его переставляет reconcilePersonalWorkspace) и после ручного
    // switchWorkspace. Подхватываем персистентный указатель, если он валиден в
    // новом наборе и отличается от in-memory: иначе setWorkspaces НЕ переставит
    // current, пока «залипшее» чужое пространство ещё присутствует в списке
    // (его строку clearUserData намеренно не удаляет). См. fix/hydrate-current-workspace.
    const savedWsId = (readSetting('current_workspace_id') || '').trim() || null;
    if (savedWsId && savedWsId !== get().currentWorkspaceId && list.some(w => w.id === savedWsId)) {
      set({ currentWorkspaceId: savedWsId, overdueMode: readOverdueModeForWs(savedWsId) });
    }
    get().setWorkspaces(list);
  },

  loadWorkspaceMembers() {
    set({ workspaceMembers: readMembersFromDb() });
  },

  // Fix 2 (fix-round2): перечитать привязку базы к аккаунту из settings и
  // синхронно обновить in-memory boundUserId + список пространств/членства.
  //
  // Без этого после смены аккаунта (AccountSwitchGate) или после первого sync
  // стор держит устаревший (или null) boundUserId, а computeRole (workspaceScope)
  // не находит строку членства текущего пользователя → owner получает
  // «Только владелец пространства может менять статусы…». Порядок важен:
  // сперва boundUserId, затем members/workspaces — чтобы селекторы, пересчитанные
  // на смену любого из этих срезов, уже видели актуальную привязку.
  reloadAccountBinding() {
    const boundUserId = (readSetting('bound_user_id') || '').trim() || null;
    set({ boundUserId });
    get().loadWorkspaceMembers();
    get().loadWorkspaces();
  },

  createWorkspace(name, kind) {
    const clean = name.trim().slice(0, 60);
    const now = new Date().toISOString();
    const clientId = getClientId();
    const boundUserId = get().boundUserId ?? readSetting('bound_user_id');
    // Уникальный серверный id пространства (== workspaces.uuid). Personal-ws
    // имеет детерминированный ws_<uid>; для новых просто ws_<uuid-hex>.
    const wsUuid = 'ws_' + uuidv7().replace(/-/g, '');
    const order =
      (db.get<{ m: number }>('SELECT COALESCE(MAX(sort_order),0)+1 AS m FROM workspaces')?.m) ?? 0;
    db.run(
      `INSERT INTO workspaces (uuid, name, kind, owner_id, sort_order, created_at, updated_at, version, client_id)
       VALUES (?,?,?,?,?,?,?,1,?)`,
      [wsUuid, clean, kind, boundUserId, order, now, now, clientId],
    );
    enqueueOutbox('workspaces', wsUuid, 'upsert');
    // owner-membership создателя.
    const memberUuid = uuidv7();
    db.run(
      `INSERT INTO workspace_members (uuid, workspace_id, user_id, role, invited_by, joined_at, created_at, updated_at, version, client_id)
       VALUES (?,?,?,'owner',?,?,?,?,1,?)`,
      [memberUuid, wsUuid, boundUserId, boundUserId, now, now, now, clientId],
    );
    enqueueOutbox('workspace_members', memberUuid, 'upsert');
    // Bug #4: сеем эталонные статусы в новое пространство (иначе доска пустая).
    seedDefaultStatuses(wsUuid);
    get().loadWorkspaces();
    get().loadWorkspaceMembers();
    // Диагностика D/E: только что созданный ws ОБЯЗАН попасть в сайдбар. Если нет
    // — сработал EXISTS-фильтр readWorkspacesFromDb (рассинхрон bound_user_id).
    if (!get().workspaces.some(w => w.id === wsUuid)) {
      logger.warn('[createWorkspace] новый ws не попал в readWorkspacesFromDb (рассинхрон bound_user_id?):', wsUuid);
    }
    get().switchWorkspace(wsUuid);
    return wsUuid;
  },

  renameWorkspace(id, name) {
    const clean = name.trim().slice(0, 60);
    if (!clean) return;
    const now = new Date().toISOString();
    db.run(
      `UPDATE workspaces SET name=?, updated_at=?, version=COALESCE(version,0)+1 WHERE uuid=?`,
      [clean, now, id],
    );
    enqueueOutbox('workspaces', id, 'upsert');
    get().loadWorkspaces();
  },

  deleteWorkspace(id) {
    const ws = get().workspaces.find(w => w.id === id);
    // Неудаляемо ТОЛЬКО системное личное пространство (детерминированный id
    // 'ws_'+boundUserId без дефисов) — дублирует серверный guard
    // block_personal_workspace_delete (0036). Дополнительные personal и shared
    // удаляются штатно.
    const boundUserId = get().boundUserId ?? readSetting('bound_user_id');
    const systemId = boundUserId ? computeWorkspaceId(boundUserId) : null;
    if (ws?.kind === 'personal' && systemId && id === systemId) {
      logger.warn('[deleteWorkspace] отказ: системное личное пространство нельзя удалить');
      get().pushToast(tr(get().language, 'ws_delete_personal_hint'));
      return;
    }
    const now = new Date().toISOString();
    db.run(
      `UPDATE workspaces SET deleted_at=?, updated_at=?, version=COALESCE(version,0)+1 WHERE uuid=?`,
      [now, now, id],
    );
    enqueueOutbox('workspaces', id, 'delete');
    get().loadWorkspaces();
    // После удаления — переключаемся на personal (или дефолт).
    const fresh = readWorkspacesFromDb();
    const target = pickDefaultWorkspaceId(fresh);
    if (get().currentWorkspaceId === id && target) {
      get().switchWorkspace(target);
    }
  },

  addWorkspaceMember(userId, role) {
    const wsId = get().currentWorkspaceId;
    if (!wsId) return;
    const now = new Date().toISOString();
    const clientId = getClientId();
    const boundUserId = get().boundUserId ?? readSetting('bound_user_id');
    // Уже есть живой член с этим user_id → просто обновляем роль (реактивация).
    const existing = db.get<{ uuid: string | null }>(
      `SELECT uuid FROM workspace_members WHERE workspace_id=? AND user_id=?`,
      [wsId, userId],
    );
    if (existing?.uuid) {
      db.run(
        `UPDATE workspace_members
            SET role=?, deleted_at=NULL, updated_at=?, version=COALESCE(version,0)+1
          WHERE uuid=?`,
        [role, now, existing.uuid],
      );
      enqueueOutbox('workspace_members', existing.uuid, 'upsert');
    } else {
      const memberUuid = uuidv7();
      db.run(
        `INSERT INTO workspace_members (uuid, workspace_id, user_id, role, invited_by, joined_at, created_at, updated_at, version, client_id)
         VALUES (?,?,?,?,?,?,?,?,1,?)`,
        [memberUuid, wsId, userId, role, boundUserId, now, now, now, clientId],
      );
      enqueueOutbox('workspace_members', memberUuid, 'upsert');
    }
    get().loadWorkspaceMembers();
  },

  updateWorkspaceMemberRole(memberId, role) {
    const now = new Date().toISOString();
    db.run(
      `UPDATE workspace_members SET role=?, updated_at=?, version=COALESCE(version,0)+1 WHERE uuid=?`,
      [role, now, memberId],
    );
    enqueueOutbox('workspace_members', memberId, 'upsert');
    get().loadWorkspaceMembers();
  },

  removeWorkspaceMember(memberId) {
    const now = new Date().toISOString();
    // F14 (симптом 2): захватываем ws/владельца строки ДО гашения и текущее
    // пространство — чтобы понять, покинул ли текущий пользователь ТЕКУЩЕЕ ws
    // (leave собственного членства) и переключить сайдбар на дефолт.
    const prevCurrent = get().currentWorkspaceId;
    const row = db.get<{ workspace_id: string | null; user_id: string | null }>(
      'SELECT workspace_id, user_id FROM workspace_members WHERE uuid=?',
      [memberId],
    );
    db.run(
      `UPDATE workspace_members SET deleted_at=?, updated_at=?, version=COALESCE(version,0)+1 WHERE uuid=?`,
      [now, now, memberId],
    );
    enqueueOutbox('workspace_members', memberId, 'delete');
    get().loadWorkspaceMembers();
    // Перечитываем сайдбар: покинутое ws уходит по EXISTS-фильтру
    // readWorkspacesFromDb (членство погашено). Без этого меню не обновлялось до
    // следующего createWorkspace.
    get().loadWorkspaces();
    // Если покинули ТЕКУЩЕЕ пространство своим членством — переключаемся на
    // дефолт (personal), как это делает deleteWorkspace.
    const boundUserId = get().boundUserId ?? readSetting('bound_user_id');
    const leftCurrentSelf =
      row?.workspace_id != null &&
      row.workspace_id === prevCurrent &&
      (row.user_id ?? null) === (boundUserId ?? null);
    if (leftCurrentSelf) {
      const target = pickDefaultWorkspaceId(readWorkspacesFromDb());
      if (target && target !== prevCurrent) get().switchWorkspace(target);
    }
  },

  switchWorkspace(id) {
    if (!id || id === get().currentWorkspaceId) return;
    const known = get().workspaces.some(w => w.id === id);
    if (!known) {
      // Пространства нет в наборе — перечитываем БД (мог появиться после pull).
      const fresh = readWorkspacesFromDb();
      set({ workspaces: fresh });
      if (!fresh.some(w => w.id === id)) {
        logger.warn('[switchWorkspace] unknown workspace id:', id);
        return;
      }
    }
    // 1. currentWorkspaceId + persist.
    set({ currentWorkspaceId: id, overdueMode: readOverdueModeForWs(id) });
    try {
      db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)', ['current_workspace_id', id]);
    } catch (e) { console.warn('[switchWorkspace] persist failed:', e); }
    // 2. Обновляем локальный стор под новое пространство.
    get().refresh();
    // 3. Дотягиваем облако для нового ws + переподписываем realtime.
    //    Ленивый import, чтобы не тащить sync-чанк в initial bundle и избежать
    //    циклической зависимости (sync → mappers → db → store).
    try {
      void import('../lib/sync').then(m => {
        try { m.resubscribeRealtime?.(); } catch (e) { logger.warn('[switchWorkspace] resubscribe failed:', e); }
        void m.syncNow?.().then(() => get().refresh()).catch(() => {});
      }).catch(() => {});
    } catch {
      // sync-модуль недоступен (например, в тестах с моками) — не мешаем.
    }
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
    // Wave A: overdue_mode — свойство ТЕКУЩЕГО пространства (workspace_settings).
    // Пишем в workspace_settings (источник истины + sync), а глобальный
    // settings.overdue_mode обновляем как легаси-зеркало/фолбэк.
    const wsId = get().currentWorkspaceId;
    if (wsId) {
      try {
        const existing = db.get<{ uuid: string | null }>(
          `SELECT uuid FROM workspace_settings WHERE workspace_id=? AND key='overdue_mode'`,
          [wsId],
        );
        const now = new Date().toISOString();
        if (existing) {
          const rowUuid = existing.uuid ?? uuidv7();
          db.run(
            `UPDATE workspace_settings
                SET value=?, uuid=COALESCE(uuid,?), deleted_at=NULL,
                    updated_at=?, version=COALESCE(version,0)+1
              WHERE workspace_id=? AND key='overdue_mode'`,
            [m, rowUuid, now, wsId],
          );
          enqueueOutbox('workspace_settings', rowUuid, 'upsert');
        } else {
          const rowUuid = uuidv7();
          db.run(
            `INSERT INTO workspace_settings (uuid, workspace_id, key, value, created_at, updated_at, version, client_id)
             VALUES (?,?, 'overdue_mode', ?, ?, ?, 1, ?)`,
            [rowUuid, wsId, m, now, now, getClientId()],
          );
          enqueueOutbox('workspace_settings', rowUuid, 'upsert');
        }
      } catch (e) {
        console.warn('[setOverdueMode] workspace_settings write failed:', e);
      }
    }
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
    const wsId = resolveWriteWorkspaceId(get().currentWorkspaceId);
    const r = db.run(
      `INSERT INTO tasks (title, comment, tag_id, status_id, start_date, deadline, finish_date, created_at, updated_at, sort_order, archived, uuid, client_id, version, workspace_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,0,?,?,1,?)`,
      [p.title || '', p.comment || '', p.tag_id ?? null, p.status_id ?? 1,
       startDate, p.deadline ?? null, finishDate, now, now, order, rowUuid, clientId, wsId]
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
    const wsId = resolveWriteWorkspaceId(get().currentWorkspaceId);
    const r = db.run(
      'INSERT INTO tags (name, color, sort_order, uuid, client_id, version, updated_at, workspace_id) VALUES (?,?,?,?,?,1,?,?)',
      [name, color, order, rowUuid, clientId, now, wsId],
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
    const wsId = resolveWriteWorkspaceId(get().currentWorkspaceId);
    const r = db.run(
      `INSERT INTO statuses (name, color, behavior, sort_order, is_seed, is_technical, hidden, default_collapsed,
                             uuid, client_id, version, updated_at, workspace_id)
       VALUES (?,?,?,?,0,0,0,0,?,?,1,?,?)`,
      [name, color, behavior, order, rowUuid, clientId, now, wsId]
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
    const wsId = resolveWriteWorkspaceId(get().currentWorkspaceId);
    const r = db.run(
      `INSERT INTO task_templates (name, title, comment, status_id, tag_id, sort_order, created_at, updated_at,
                                   uuid, client_id, version, workspace_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,1,?)`,
      [p.name, p.title ?? '', p.comment ?? '', p.status_id ?? null, p.tag_id ?? null, order, now, now, rowUuid, clientId, wsId]
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
