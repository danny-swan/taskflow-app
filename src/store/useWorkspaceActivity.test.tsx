// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// Тесты workspace-scope журнала (Wave C, PR-c-04): reloadWorkspace читает весь
// лог пространства (created_at DESC), useWorkspaceActivity применяет клиентские
// фильтры (kind/user/task) и пагинацию по WS_PAGE_SIZE (50) с loadMore.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

let ROWS: any[] = [];
let throwOnQuery = false;

vi.mock('../lib/db', () => ({
  all: (_sql: string, params: any[] = []) => {
    if (throwOnQuery) throw new Error('no such table: task_activity_log');
    const [workspaceId] = params;
    return ROWS.filter(r => r.workspace_id === workspaceId)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1)); // created_at DESC
  },
}));

vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  useTaskActivityStore,
  useWorkspaceActivity,
  WS_PAGE_SIZE,
} from './useTaskActivityStore';

function row(i: number, over: Partial<any> = {}) {
  const n = String(i).padStart(4, '0');
  return {
    uuid: `log-${n}`,
    task_id: `task-${n}`,
    workspace_id: 'ws1',
    user_id: 'u1',
    kind: 'status_changed',
    payload: JSON.stringify({}),
    created_at: `2026-01-01T00:00:${n.slice(-2)}Z`,
    ...over,
  };
}

beforeEach(() => {
  ROWS = [];
  throwOnQuery = false;
  useTaskActivityStore.getState().clear();
});

describe('reloadWorkspace', () => {
  it('читает весь лог пространства, сортировка created_at DESC', () => {
    ROWS = [row(1), row(2), row(3), row(9, { workspace_id: 'other' })];
    useTaskActivityStore.getState().reloadWorkspace('ws1');
    const recs = useTaskActivityStore.getState().byWorkspace['ws1'];
    expect(recs).toHaveLength(3); // чужое пространство отфильтровано
    expect(recs[0].createdAt > recs[1].createdAt).toBe(true);
  });

  it('ошибка db (нет таблицы) → пустой лог, без исключения', () => {
    throwOnQuery = true;
    expect(() => useTaskActivityStore.getState().reloadWorkspace('ws1')).not.toThrow();
    expect(useTaskActivityStore.getState().byWorkspace['ws1']).toEqual([]);
  });
});

describe('useWorkspaceActivity', () => {
  it('workspaceId=null → пустой результат', () => {
    ROWS = [row(1)];
    const { result } = renderHook(() => useWorkspaceActivity(null));
    expect(result.current.records).toEqual([]);
    expect(result.current.total).toBe(0);
    expect(result.current.hasMore).toBe(false);
  });

  it('пагинация: первая страница WS_PAGE_SIZE, loadMore догружает', () => {
    ROWS = Array.from({ length: WS_PAGE_SIZE + 10 }, (_, i) => row(i + 1));
    const { result } = renderHook(() => useWorkspaceActivity('ws1'));
    expect(result.current.records).toHaveLength(WS_PAGE_SIZE);
    expect(result.current.total).toBe(WS_PAGE_SIZE + 10);
    expect(result.current.hasMore).toBe(true);

    act(() => result.current.loadMore());
    expect(result.current.records).toHaveLength(WS_PAGE_SIZE + 10);
    expect(result.current.hasMore).toBe(false);
  });

  it('фильтр по kind — только совпадающие типы', () => {
    ROWS = [
      row(1, { kind: 'created' }),
      row(2, { kind: 'status_changed' }),
      row(3, { kind: 'deleted' }),
    ];
    const { result } = renderHook(() => useWorkspaceActivity('ws1', { kinds: ['created', 'deleted'] }));
    expect(result.current.total).toBe(2);
    expect(result.current.records.map(r => r.kind).sort()).toEqual(['created', 'deleted']);
  });

  it('пустой массив kinds трактуется как «все»', () => {
    ROWS = [row(1, { kind: 'created' }), row(2, { kind: 'deleted' })];
    const { result } = renderHook(() => useWorkspaceActivity('ws1', { kinds: [] }));
    expect(result.current.total).toBe(2);
  });

  it('фильтр по участнику — только его записи', () => {
    ROWS = [
      row(1, { user_id: 'alice' }),
      row(2, { user_id: 'bob' }),
      row(3, { user_id: 'alice' }),
    ];
    const { result } = renderHook(() => useWorkspaceActivity('ws1', { userId: 'alice' }));
    expect(result.current.total).toBe(2);
    expect(result.current.records.every(r => r.userId === 'alice')).toBe(true);
  });

  it('фильтр по задаче (taskIds) — только по этим задачам', () => {
    ROWS = [
      row(1, { task_id: 'task-A' }),
      row(2, { task_id: 'task-B' }),
      row(3, { task_id: 'task-C' }),
    ];
    const { result } = renderHook(() => useWorkspaceActivity('ws1', { taskIds: ['task-A', 'task-C'] }));
    expect(result.current.total).toBe(2);
    expect(result.current.records.map(r => r.taskId).sort()).toEqual(['task-A', 'task-C']);
  });

  it('пустой taskIds → нет совпадений (не «все»)', () => {
    ROWS = [row(1), row(2)];
    const { result } = renderHook(() => useWorkspaceActivity('ws1', { taskIds: [] }));
    expect(result.current.total).toBe(0);
  });
});
