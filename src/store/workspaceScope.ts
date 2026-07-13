// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
/**
 * workspaceScope.ts — ws-scoped селекторы (Wave A, PR-3 «Store + UI»).
 *
 * ЕДИНСТВЕННЫЙ санкционированный способ читать задачи/статусы/теги/шаблоны в
 * UI-слое. Все страницы и компоненты обязаны ходить через эти хуки, а НЕ через
 * голый `useStore(s => s.tasks)` — иначе при нескольких пространствах (Wave B)
 * произойдёт смешение данных разных ws.
 *
 * Инвариант (dev-guard): в UI видны только строки текущего пространства
 * (`currentWorkspaceId`). `filterByWorkspace` в dev-сборке предупреждает, если
 * встречает строку без `workspace_id` (значит, какой-то writer забыл его
 * проставить) — это фиксирует контракт заранее, до Wave B.
 */
import { useMemo } from 'react';
import { useStore, type Task, type Status, type Tag, type TaskTemplate, type Workspace } from './useStore';

export type WorkspaceRole = 'owner' | 'editor' | 'viewer';

type WsScoped = { workspace_id?: string | null };

let _warnedNullWs = false;

/**
 * Отфильтровать строки по текущему пространству.
 *
 * - `wsId == null` → возвращаем как есть (пространство ещё не выбрано; на этом
 *   этапе UI обычно не отрисован, ломать выборку смысла нет).
 * - иначе → только строки с `workspace_id === wsId`.
 *
 * Dev-guard: если попалась строка без `workspace_id`, один раз предупреждаем в
 * консоль — это признак writer'а в обход ws-контракта.
 */
export function filterByWorkspace<T extends WsScoped>(rows: T[], wsId: string | null): T[] {
  if (!wsId) return rows;
  if (import.meta.env.DEV && !_warnedNullWs && rows.some(r => r.workspace_id == null)) {
    _warnedNullWs = true;
    // eslint-disable-next-line no-console
    console.warn(
      '[workspaceScope] обнаружена строка без workspace_id — ' +
      'какой-то writer создаёт данные в обход ws-контракта (Wave A/B регрессия).',
    );
  }
  return rows.filter(r => r.workspace_id === wsId);
}

/** id текущего пространства (или null, если ещё не выбрано). */
export function useCurrentWorkspaceId(): string | null {
  return useStore(s => s.currentWorkspaceId);
}

/** Текущее пространство целиком (объект Workspace) или null. */
export function useCurrentWorkspace(): Workspace | null {
  const id = useStore(s => s.currentWorkspaceId);
  const list = useStore(s => s.workspaces);
  return useMemo(() => list.find(w => w.id === id) ?? null, [list, id]);
}

/** Список всех доступных пространств. */
export function useWorkspaces(): Workspace[] {
  return useStore(s => s.workspaces);
}

/** Задачи ТЕКУЩЕГО пространства (полный набор: с архивными/техническими). */
export function useCurrentWorkspaceTasks(): Task[] {
  const tasks = useStore(s => s.tasks);
  const wsId = useStore(s => s.currentWorkspaceId);
  return useMemo(() => filterByWorkspace(tasks, wsId), [tasks, wsId]);
}

/** Статусы ТЕКУЩЕГО пространства (включая технические — для Stats/Dashboard). */
export function useCurrentWorkspaceStatuses(): Status[] {
  const statuses = useStore(s => s.statuses);
  const wsId = useStore(s => s.currentWorkspaceId);
  return useMemo(() => filterByWorkspace(statuses, wsId), [statuses, wsId]);
}

/** Теги ТЕКУЩЕГО пространства. */
export function useCurrentWorkspaceTags(): Tag[] {
  const tags = useStore(s => s.tags);
  const wsId = useStore(s => s.currentWorkspaceId);
  return useMemo(() => filterByWorkspace(tags, wsId), [tags, wsId]);
}

/** Шаблоны задач ТЕКУЩЕГО пространства. */
export function useCurrentWorkspaceTemplates(): TaskTemplate[] {
  const templates = useStore(s => s.taskTemplates);
  const wsId = useStore(s => s.currentWorkspaceId);
  return useMemo(() => filterByWorkspace(templates, wsId), [templates, wsId]);
}

/**
 * Роль текущего пользователя в ТЕКУЩЕМ пространстве (Wave A, PR-4).
 *
 * Ищет живую строку членства в локальном зеркале `workspace_members` по
 * (currentWorkspaceId, bound_user_id). Особые случаи:
 *   • personal-ws → всегда 'owner' (владелец — сам пользователь);
 *   • ws_local (local-only, ещё не привязан) → 'owner';
 *   • ws не выбран / членство не найдено → null.
 *
 * Это UX-слой: сервер (RLS в 0027) — источник истины для записи.
 */
export function useCurrentWorkspaceRole(): WorkspaceRole | null {
  const wsId = useStore(s => s.currentWorkspaceId);
  const workspaces = useStore(s => s.workspaces);
  const members = useStore(s => s.workspaceMembers);
  const boundUserId = useStore(s => s.boundUserId);
  return useMemo(() => {
    if (!wsId) return null;
    // local-only пространство — пользователь всегда владелец.
    if (wsId === 'ws_local') return 'owner';
    const ws = workspaces.find(w => w.id === wsId);
    if (ws?.kind === 'personal') return 'owner';
    const mine = members.find(m => m.workspace_id === wsId && m.user_id === boundUserId);
    const role = mine?.role;
    if (role === 'owner' || role === 'editor' || role === 'viewer') return role;
    return null;
  }, [wsId, workspaces, members, boundUserId]);
}

/**
 * Роль текущего пользователя в КАЖДОМ доступном пространстве (Wave B, PR-b-05).
 *
 * Возвращает карту `{ [workspaceId]: WorkspaceRole | null }` для рендера
 * role-badge в переключателе. Логика на пространство совпадает с
 * {@link useCurrentWorkspaceRole}:
 *   • personal-ws → 'owner';
 *   • ws_local → 'owner';
 *   • shared → строка членства (currentUser) в локальном зеркале;
 *   • членство не найдено → null (badge не рисуем).
 */
export function useWorkspaceRoles(): Record<string, WorkspaceRole | null> {
  const workspaces = useStore(s => s.workspaces);
  const members = useStore(s => s.workspaceMembers);
  const boundUserId = useStore(s => s.boundUserId);
  return useMemo(() => {
    const out: Record<string, WorkspaceRole | null> = {};
    for (const ws of workspaces) {
      if (ws.id === 'ws_local' || ws.kind === 'personal') {
        out[ws.id] = 'owner';
        continue;
      }
      const mine = members.find(m => m.workspace_id === ws.id && m.user_id === boundUserId);
      const role = mine?.role;
      out[ws.id] = role === 'owner' || role === 'editor' || role === 'viewer' ? role : null;
    }
    return out;
  }, [workspaces, members, boundUserId]);
}

/**
 * Можно ли РЕДАКТИРОВАТЬ данные текущего пространства.
 * viewer — строго read-only (false). owner/editor — true. null (роль неизвестна,
 * напр. пространство ещё не загрузилось) трактуем как true, чтобы не блокировать
 * личное пространство до подхвата членства (worst-case сервер всё равно отсечёт).
 */
export function useCanEdit(): boolean {
  const role = useCurrentWorkspaceRole();
  return role !== 'viewer';
}

/**
 * Является ли текущий пользователь viewer'ом в текущем пространстве.
 * Строгое дополнение к {@link useCanEdit}: true только при role === 'viewer'.
 * Используется UI-слоем (PR-c-05) для read-only tooltip'ов и disabled-кнопок.
 */
export function useIsViewer(): boolean {
  return useCurrentWorkspaceRole() === 'viewer';
}
