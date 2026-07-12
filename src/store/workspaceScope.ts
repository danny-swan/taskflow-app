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
