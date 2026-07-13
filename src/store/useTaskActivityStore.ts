// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// useTaskActivityStore — журнал активности задачи (Wave C, PR-c-03).
//
// Читает локальное зеркало task_activity_log (миграция v13; наполняется только
// через pull — записи создаёт серверный триггер log_task_activity в shared-
// пространствах, см. supabase/migrations/0034_task_activity_log.sql). Клиент лог
// только читает: здесь нет ни INSERT, ни push.
//
// Пагинация: страница PAGE_SIZE=20, сортировка created_at DESC (свежие сверху).
// Чтобы узнать «есть ли ещё», выбираем limit+1 строку и обрезаем.
import { create } from 'zustand';
import { useEffect, useMemo, useState } from 'react';
import * as db from '../lib/db';
import { logger } from '../lib/logger';

/** Тип значимого события задачи (совпадает с CHECK на sync_task_activity_log.kind). */
export type ActivityKind =
  | 'created'
  | 'status_changed'
  | 'deadline_changed'
  | 'title_changed'
  | 'description_changed'
  | 'deleted'
  | 'restored'
  | 'tag_added'
  | 'tag_removed';

/** Запись журнала (payload уже распарсен из JSON-строки локального зеркала). */
export interface ActivityRecord {
  id: string;               // = серверный sync_task_activity_log.id (uuid)
  taskId: string;           // серверный uuid задачи
  workspaceId: string;
  userId: string;           // uuid автора действия
  kind: ActivityKind;
  payload: Record<string, unknown>;
  createdAt: string;
}

export const PAGE_SIZE = 20;
/** Размер страницы в workspace-логе (PR-c-04) — крупнее, чем в модалке задачи. */
export const WS_PAGE_SIZE = 50;

/** Стабильная пустая ссылка — чтобы zustand-селектор не ре-рендерил вхолостую. */
const EMPTY_RECORDS: ActivityRecord[] = [];

interface ActivityLogRow {
  uuid: string;
  task_id: string;
  workspace_id: string;
  user_id: string;
  kind: string;
  payload: string;
  created_at: string;
}

function parseRow(r: ActivityLogRow): ActivityRecord {
  let payload: Record<string, unknown> = {};
  try {
    const p = JSON.parse(r.payload || '{}');
    if (p && typeof p === 'object') payload = p as Record<string, unknown>;
  } catch {
    // битый JSON — оставляем пустой payload, событие всё равно покажем.
  }
  return {
    id: r.uuid,
    taskId: r.task_id,
    workspaceId: r.workspace_id,
    userId: r.user_id,
    kind: r.kind as ActivityKind,
    payload,
    createdAt: r.created_at,
  };
}

/** Читает страницу журнала задачи. Возвращает записи + флаг «есть ещё». */
function queryActivity(taskUuid: string, limit: number): { records: ActivityRecord[]; hasMore: boolean } {
  try {
    const rows = db.all<ActivityLogRow>(
      `SELECT uuid, task_id, workspace_id, user_id, kind, payload, created_at
         FROM task_activity_log
        WHERE task_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT ?`,
      [taskUuid, limit + 1],
    );
    const hasMore = rows.length > limit;
    const sliced = hasMore ? rows.slice(0, limit) : rows;
    return { records: sliced.map(parseRow), hasMore };
  } catch (e) {
    // Таблицы может не быть (миграция ещё не прогнана / local-only без sync) —
    // это не ошибка для UI, просто нет истории.
    logger.info('[activity] query failed (no mirror table?):', e);
    return { records: [], hasMore: false };
  }
}

/**
 * Читает ВЕСЬ журнал пространства (created_at DESC). Фильтры и пагинация —
 * на клиенте (SQLite mirror быстрый, server-side пагинация не нужна, см. §4
 * wave-c-plan). При отсутствии таблицы возвращает пустой список.
 */
function queryWorkspaceActivity(workspaceId: string): ActivityRecord[] {
  try {
    const rows = db.all<ActivityLogRow>(
      `SELECT uuid, task_id, workspace_id, user_id, kind, payload, created_at
         FROM task_activity_log
        WHERE workspace_id = ?
        ORDER BY created_at DESC, id DESC`,
      [workspaceId],
    );
    return rows.map(parseRow);
  } catch (e) {
    logger.info('[activity] workspace query failed (no mirror table?):', e);
    return [];
  }
}

interface TaskActivityState {
  /** Загруженные записи по uuid задачи. */
  byTask: Record<string, ActivityRecord[]>;
  /** Текущий лимит выборки по задаче (растёт при loadMore). */
  limit: Record<string, number>;
  /** Есть ли ещё записи за пределами текущего лимита. */
  hasMore: Record<string, boolean>;
  /** Полный (нефильтрованный) журнал по workspace (PR-c-04). */
  byWorkspace: Record<string, ActivityRecord[]>;

  /** Перечитать журнал задачи с текущим (или начальным) лимитом. */
  reload: (taskUuid: string) => void;
  /** Подгрузить следующую страницу. */
  loadMore: (taskUuid: string) => void;
  /** Перечитать весь журнал пространства (PR-c-04). */
  reloadWorkspace: (workspaceId: string) => void;
  /** Очистить кеш (смена задачи/логаут). */
  clear: () => void;
}

export const useTaskActivityStore = create<TaskActivityState>((set, get) => ({
  byTask: {},
  limit: {},
  hasMore: {},
  byWorkspace: {},

  reload(taskUuid) {
    const limit = get().limit[taskUuid] ?? PAGE_SIZE;
    const { records, hasMore } = queryActivity(taskUuid, limit);
    set((s) => ({
      byTask: { ...s.byTask, [taskUuid]: records },
      limit: { ...s.limit, [taskUuid]: limit },
      hasMore: { ...s.hasMore, [taskUuid]: hasMore },
    }));
  },

  loadMore(taskUuid) {
    const nextLimit = (get().limit[taskUuid] ?? PAGE_SIZE) + PAGE_SIZE;
    const { records, hasMore } = queryActivity(taskUuid, nextLimit);
    set((s) => ({
      byTask: { ...s.byTask, [taskUuid]: records },
      limit: { ...s.limit, [taskUuid]: nextLimit },
      hasMore: { ...s.hasMore, [taskUuid]: hasMore },
    }));
  },

  reloadWorkspace(workspaceId) {
    const records = queryWorkspaceActivity(workspaceId);
    set((s) => ({ byWorkspace: { ...s.byWorkspace, [workspaceId]: records } }));
  },

  clear() {
    set({ byTask: {}, limit: {}, hasMore: {}, byWorkspace: {} });
  },
}));

export interface UseTaskActivityResult {
  records: ActivityRecord[];
  hasMore: boolean;
  loadMore: () => void;
  reload: () => void;
}

/**
 * Хук журнала активности для одной задачи. Загружает первую страницу при
 * появлении/смене taskUuid. taskUuid=null/undefined (задача без uuid — не
 * синхронизирована) → пустой результат, запросов нет.
 */
export function useTaskActivity(taskUuid: string | null | undefined): UseTaskActivityResult {
  const records = useTaskActivityStore((s) => (taskUuid ? s.byTask[taskUuid] ?? [] : []));
  const hasMore = useTaskActivityStore((s) => (taskUuid ? s.hasMore[taskUuid] ?? false : false));
  const reload = useTaskActivityStore((s) => s.reload);
  const loadMore = useTaskActivityStore((s) => s.loadMore);

  useEffect(() => {
    if (taskUuid) reload(taskUuid);
  }, [taskUuid, reload]);

  return {
    records,
    hasMore,
    loadMore: () => taskUuid && loadMore(taskUuid),
    reload: () => taskUuid && reload(taskUuid),
  };
}

/** Фильтры workspace-лога (все клиентские). Пустые/undefined → «все». */
export interface WorkspaceActivityFilters {
  /** Оставить только эти типы действий. Пусто/undefined → все типы. */
  kinds?: ActivityKind[] | null;
  /** Оставить действия только этого автора (uuid). null/undefined → все. */
  userId?: string | null;
  /** Оставить действия только по этим задачам (uuid). null/undefined → все. */
  taskIds?: string[] | null;
}

export interface UseWorkspaceActivityResult {
  /** Отфильтрованные и обрезанные до текущего лимита записи. */
  records: ActivityRecord[];
  /** Всего записей после фильтрации (до пагинации). */
  total: number;
  /** Есть ли ещё записи за пределами текущего лимита. */
  hasMore: boolean;
  /** Показать следующую страницу (+pageSize). */
  loadMore: () => void;
  /** Перечитать журнал пространства из зеркала. */
  reload: () => void;
}

/**
 * Хук workspace-scope журнала (PR-c-04). Загружает весь лог пространства из
 * локального зеркала, применяет клиентские фильтры (kind/user/task) и отдаёт
 * страницу размером pageSize с кнопкой «Показать ещё».
 *
 * workspaceId=null/undefined (personal / не выбран) → пустой результат.
 */
export function useWorkspaceActivity(
  workspaceId: string | null | undefined,
  filters: WorkspaceActivityFilters = {},
  pageSize = WS_PAGE_SIZE,
): UseWorkspaceActivityResult {
  const all = useTaskActivityStore((s) => (workspaceId ? s.byWorkspace[workspaceId] ?? EMPTY_RECORDS : EMPTY_RECORDS));
  const reloadWorkspace = useTaskActivityStore((s) => s.reloadWorkspace);
  const [visible, setVisible] = useState(pageSize);

  useEffect(() => {
    if (workspaceId) reloadWorkspace(workspaceId);
  }, [workspaceId, reloadWorkspace]);

  // Стабильные ключи фильтров, чтобы useMemo не пересчитывался вхолостую.
  const kindsKey = filters.kinds && filters.kinds.length ? [...filters.kinds].sort().join(',') : '';
  const taskKey = filters.taskIds ? [...filters.taskIds].sort().join(',') : null;
  const userId = filters.userId ?? null;

  const filtered = useMemo(() => {
    const kindSet = kindsKey ? new Set(kindsKey.split(',')) : null;
    const taskSet = taskKey !== null ? new Set(taskKey ? taskKey.split(',') : []) : null;
    return all.filter((r) => {
      if (kindSet && !kindSet.has(r.kind)) return false;
      if (userId && r.userId !== userId) return false;
      if (taskSet && !taskSet.has(r.taskId)) return false;
      return true;
    });
  }, [all, kindsKey, userId, taskKey]);

  // Смена фильтров/пространства сбрасывает пагинацию на первую страницу.
  useEffect(() => {
    setVisible(pageSize);
  }, [workspaceId, kindsKey, userId, taskKey, pageSize]);

  return {
    records: filtered.slice(0, visible),
    total: filtered.length,
    hasMore: filtered.length > visible,
    loadMore: () => setVisible((v) => v + pageSize),
    reload: () => workspaceId && reloadWorkspace(workspaceId),
  };
}
