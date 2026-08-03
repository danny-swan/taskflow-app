/**
 * Тесты Wave A (PR-3 «Store + UI»):
 *   a) filterByWorkspace — ws-scoped выборка (только строки текущего ws);
 *   b) dev-guard — предупреждение о строке без workspace_id;
 *   c) switchWorkspace — смена ws меняет overdueMode (business/calendar) и persist;
 *   d) overdue-расчёт: у ws с 'business' просрочка считается по рабочим дням.
 *
 * db.ts мокаем — реальный SQLite не нужен; db.get подменяем по запросу, чтобы
 * отдавать разный overdue_mode для разных пространств.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const dbGet = vi.fn();
const dbRun = vi.fn();

vi.mock('../lib/db', () => ({
  initDb: vi.fn(async () => {}),
  get: (...args: any[]) => dbGet(...args),
  all: vi.fn(() => []),
  run: (...args: any[]) => dbRun(...args),
  exec: vi.fn(),
  save: vi.fn(async () => {}),
  isReady: vi.fn(() => true),
}));

vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { useStore, type Task, type Workspace } from './useStore';
import { filterByWorkspace } from './workspaceScope';
import { daysUntilDeadline } from '../lib/utils';

const ws = (id: string, kind: string, name: string): Workspace =>
  ({ id, name, kind, owner_id: null, sort_order: 0 });

const wsTask = (id: number, wsId: string | null): Task =>
  ({
    id, title: `t${id}`, comment: '', tag_id: null, status_id: 1,
    start_date: null, deadline: null, finish_date: null,
    created_at: '2026-07-01', updated_at: '2026-07-01', sort_order: id,
    archived: 0, workspace_id: wsId,
  }) as Task;

beforeEach(() => {
  dbGet.mockReset();
  dbRun.mockReset();
  useStore.setState({
    ready: true, statuses: [], tags: [], tasks: [], toasts: [],
    workspaces: [], currentWorkspaceId: null, overdueMode: 'calendar',
  });
});

describe('a) filterByWorkspace', () => {
  it('возвращает только строки текущего пространства', () => {
    const rows = [wsTask(1, 'ws_a'), wsTask(2, 'ws_b'), wsTask(3, 'ws_a')];
    expect(filterByWorkspace(rows, 'ws_a').map(r => r.id)).toEqual([1, 3]);
  });

  it('возвращает всё, если ws не выбран (null)', () => {
    const rows = [wsTask(1, 'ws_a'), wsTask(2, 'ws_b')];
    expect(filterByWorkspace(rows, null)).toHaveLength(2);
  });
});

describe('b) dev-guard: строка без workspace_id', () => {
  it('предупреждает в dev при строке с null workspace_id', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // wsTask(9, null) — writer забыл проставить workspace_id.
    const rows = [wsTask(1, 'ws_a'), wsTask(9, null)];
    const out = filterByWorkspace(rows, 'ws_a');
    expect(out.map(r => r.id)).toEqual([1]); // null-строка отфильтрована
    // Guard срабатывает только под import.meta.env.DEV; в vitest DEV=true.
    if (import.meta.env.DEV) {
      expect(warn).toHaveBeenCalled();
    }
    warn.mockRestore();
  });
});

describe('c) switchWorkspace меняет overdueMode и persist', () => {
  it('business для одного ws, calendar для другого', () => {
    // db.get отдаёт overdue_mode в зависимости от workspace_id из параметров.
    dbGet.mockImplementation((sql: string, params?: any[]) => {
      if (sql.includes('workspace_settings') && params?.[0] === 'ws_biz') {
        return { value: 'business' };
      }
      if (sql.includes('workspace_settings') && params?.[0] === 'ws_cal') {
        return { value: 'calendar' };
      }
      return undefined;
    });

    useStore.setState({
      workspaces: [ws('ws_biz', 'personal', 'Бизнес'), ws('ws_cal', 'shared', 'Календарь')],
      currentWorkspaceId: 'ws_cal',
      overdueMode: 'calendar',
    });

    useStore.getState().switchWorkspace('ws_biz');
    expect(useStore.getState().currentWorkspaceId).toBe('ws_biz');
    expect(useStore.getState().overdueMode).toBe('business');
    // persist current_workspace_id
    expect(dbRun).toHaveBeenCalledWith(
      expect.any(String),
      ['current_workspace_id', 'ws_biz'],
    );

    useStore.getState().switchWorkspace('ws_cal');
    expect(useStore.getState().overdueMode).toBe('calendar');
  });

  it('no-op при переключении на то же самое пространство', () => {
    useStore.setState({
      workspaces: [ws('ws_a', 'personal', 'A')],
      currentWorkspaceId: 'ws_a',
    });
    useStore.getState().switchWorkspace('ws_a');
    expect(dbRun).not.toHaveBeenCalled();
  });
});

describe('d) overdue-расчёт: business = рабочие дни', () => {
  it('пятница→понедельник = 1 рабочий день (business), 3 календарных', () => {
    // 2026-07-10 — пятница, 2026-07-13 — понедельник.
    const friday = '2026-07-10';
    const monday = '2026-07-13';
    expect(daysUntilDeadline(monday, friday, 'calendar')).toBe(3);
    expect(daysUntilDeadline(monday, friday, 'business')).toBe(1);
  });
});
