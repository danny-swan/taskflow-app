// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// Unit-тесты useTaskActivityStore (Wave C, PR-c-03): чтение из зеркала, парсинг
// payload, пагинация (PAGE_SIZE + loadMore + hasMore), устойчивость к ошибкам db.
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Мокаем локальную БД: db.all возвращает из управляемого массива с учётом
// task_id-фильтра и LIMIT (последний параметр).
let ROWS: any[] = [];
let throwOnQuery = false;

vi.mock('../lib/db', () => ({
  all: (_sql: string, params: any[] = []) => {
    if (throwOnQuery) throw new Error('no such table: task_activity_log');
    const [taskId, limit] = params;
    const filtered = ROWS.filter(r => r.task_id === taskId)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1)); // created_at DESC
    return filtered.slice(0, limit);
  },
}));

vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { useTaskActivityStore, PAGE_SIZE } from './useTaskActivityStore';

function row(i: number, taskId = 't1', over: Partial<any> = {}) {
  const n = String(i).padStart(4, '0');
  return {
    uuid: `log-${taskId}-${n}`,
    task_id: taskId,
    workspace_id: 'ws1',
    user_id: 'u1',
    kind: 'status_changed',
    payload: JSON.stringify({ old: 'st1', new: 'st2' }),
    created_at: `2026-01-01T00:00:${n.slice(-2)}Z`,
    ...over,
  };
}

beforeEach(() => {
  ROWS = [];
  throwOnQuery = false;
  useTaskActivityStore.getState().clear();
});

describe('useTaskActivityStore', () => {
  it('reload читает первую страницу и парсит payload', () => {
    ROWS = [row(1)];
    useTaskActivityStore.getState().reload('t1');
    const recs = useTaskActivityStore.getState().byTask['t1'];
    expect(recs).toHaveLength(1);
    expect(recs[0].kind).toBe('status_changed');
    expect(recs[0].payload).toEqual({ old: 'st1', new: 'st2' });
    expect(recs[0].id).toBe('log-t1-0001');
  });

  it('фильтрует по task_id (чужие записи не попадают)', () => {
    ROWS = [row(1, 't1'), row(2, 't2')];
    useTaskActivityStore.getState().reload('t1');
    expect(useTaskActivityStore.getState().byTask['t1']).toHaveLength(1);
    expect(useTaskActivityStore.getState().byTask['t1'][0].taskId).toBe('t1');
  });

  it('hasMore=true когда записей больше страницы; loadMore подгружает ещё', () => {
    ROWS = Array.from({ length: PAGE_SIZE + 5 }, (_, i) => row(i + 1));
    const st = useTaskActivityStore.getState();
    st.reload('t1');
    expect(useTaskActivityStore.getState().byTask['t1']).toHaveLength(PAGE_SIZE);
    expect(useTaskActivityStore.getState().hasMore['t1']).toBe(true);

    st.loadMore('t1');
    expect(useTaskActivityStore.getState().byTask['t1']).toHaveLength(PAGE_SIZE + 5);
    expect(useTaskActivityStore.getState().hasMore['t1']).toBe(false);
  });

  it('hasMore=false когда записей ровно страница', () => {
    ROWS = Array.from({ length: PAGE_SIZE }, (_, i) => row(i + 1));
    useTaskActivityStore.getState().reload('t1');
    expect(useTaskActivityStore.getState().hasMore['t1']).toBe(false);
  });

  it('сортировка created_at DESC — свежие сверху', () => {
    ROWS = [row(1), row(2), row(3)];
    useTaskActivityStore.getState().reload('t1');
    const recs = useTaskActivityStore.getState().byTask['t1'];
    expect(recs[0].createdAt > recs[1].createdAt).toBe(true);
  });

  it('битый payload → пустой объект, запись не теряется', () => {
    ROWS = [row(1, 't1', { payload: '{not json' })];
    useTaskActivityStore.getState().reload('t1');
    const recs = useTaskActivityStore.getState().byTask['t1'];
    expect(recs).toHaveLength(1);
    expect(recs[0].payload).toEqual({});
  });

  it('ошибка db (нет таблицы) → пустой журнал, без исключения', () => {
    throwOnQuery = true;
    expect(() => useTaskActivityStore.getState().reload('t1')).not.toThrow();
    expect(useTaskActivityStore.getState().byTask['t1']).toEqual([]);
    expect(useTaskActivityStore.getState().hasMore['t1']).toBe(false);
  });

  it('clear сбрасывает кеш', () => {
    ROWS = [row(1)];
    useTaskActivityStore.getState().reload('t1');
    useTaskActivityStore.getState().clear();
    expect(useTaskActivityStore.getState().byTask).toEqual({});
    expect(useTaskActivityStore.getState().limit).toEqual({});
  });
});
