// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// Рендер-тесты WorkspaceHistoryTab (Wave C, PR-c-04): пустое состояние,
// список + «Показать ещё», фильтры (kind/user), fallback ника → TF-ID (не email),
// открытие живой задачи через навигацию, пометка «(удалена)» и кнопка-иконка
// «Обновить».
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import type { ActivityRecord } from '../store/useTaskActivityStore';

let storeState: any;
let presenceState: any;
let hookResult: any;
let lastFilters: any;
const loadMore = vi.fn();
const navigate = vi.fn();
const reload = vi.fn();

vi.mock('../store/useStore', () => ({
  useStore: (selector: (s: any) => unknown) => selector(storeState),
}));
vi.mock('../store/usePresenceStore', () => ({
  usePresenceStore: (selector: (s: any) => unknown) => selector(presenceState),
}));
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
}));
vi.mock('../store/useTaskActivityStore', () => ({
  useWorkspaceActivity: (_wsId: any, filters: any) => {
    lastFilters = filters;
    return hookResult;
  },
}));

import { WorkspaceHistoryTab } from './WorkspaceHistoryTab';

function rec(over: Partial<ActivityRecord> = {}): ActivityRecord {
  return {
    id: `log-${Math.random().toString(36).slice(2)}`,
    taskId: 'task-uuid-1',
    workspaceId: 'ws1',
    userId: 'author-uuid-1234567890',
    kind: 'status_changed',
    payload: {},
    createdAt: new Date().toISOString(),
    ...over,
  };
}

beforeEach(() => {
  loadMore.mockReset();
  navigate.mockReset();
  reload.mockReset();
  lastFilters = undefined;
  storeState = {
    language: 'ru',
    currentWorkspaceId: 'ws1',
    boundUserId: 'me-uuid',
    workspaceMembers: [],
    tasks: [],
  };
  presenceState = { byId: {} };
  hookResult = { records: [], total: 0, hasMore: false, loadMore, reload };
});

describe('WorkspaceHistoryTab', () => {
  it('пустое состояние при отсутствии записей', () => {
    render(<WorkspaceHistoryTab />);
    expect(screen.getByText(/Нет записей истории/i)).toBeTruthy();
  });

  it('рендерит записи и «Показать ещё» при hasMore', () => {
    hookResult = { records: [rec({ userId: 'me-uuid' })], total: 60, hasMore: true, loadMore, reload };
    render(<WorkspaceHistoryTab />);
    expect(screen.getByText('вы')).toBeTruthy();
    const more = screen.getByRole('button', { name: /Показать ещё/i });
    fireEvent.click(more);
    expect(loadMore).toHaveBeenCalledTimes(1);
  });

  it('нет «Показать ещё» когда hasMore=false', () => {
    hookResult = { records: [rec()], total: 1, hasMore: false, loadMore, reload };
    render(<WorkspaceHistoryTab />);
    expect(screen.queryByRole('button', { name: /Показать ещё/i })).toBeNull();
  });

  it('фильтр по типу действия передаётся в хук', () => {
    render(<WorkspaceHistoryTab />);
    fireEvent.click(screen.getByRole('button', { name: /Тип действия/i }));
    // Чекбокс «сменил(а) статус» = kind status_changed.
    fireEvent.click(screen.getByLabelText(/сменил\(а\) статус/i));
    expect(lastFilters.kinds).toContain('status_changed');
  });

  it('фильтр по участнику: fallback ника → TF-ID (не email)', () => {
    storeState.workspaceMembers = [
      { id: 'm1', workspace_id: 'ws1', user_id: 'alice-uuid', role: 'editor' },
    ];
    presenceState = { byId: { 'alice-uuid': { nickname: '', publicUserId: 'TF-ALICE', avatarVariant: 2 } } };
    render(<WorkspaceHistoryTab />);
    fireEvent.click(screen.getByRole('button', { name: /Участник/i }));
    // Пустой ник → показываем публичный TF-ID.
    expect(screen.getByText('TF-ALICE')).toBeTruthy();
    fireEvent.click(screen.getByText('TF-ALICE'));
    expect(lastFilters.userId).toBe('alice-uuid');
  });

  it('живая задача — ссылка открывает модалку через навигацию', () => {
    hookResult = {
      records: [rec({ taskId: 'task-uuid-1' })],
      total: 1, hasMore: false, loadMore, reload,
    };
    storeState.tasks = [{ id: 42, uuid: 'task-uuid-1', title: 'Купить хлеб', deleted_at: null }];
    render(<WorkspaceHistoryTab />);
    const link = screen.getByRole('button', { name: /Купить хлеб/i });
    fireEvent.click(link);
    expect(navigate).toHaveBeenCalledWith('/tasks?task=42');
  });

  it('удалённая задача — пометка «(удалена)», без ссылки', () => {
    hookResult = {
      records: [rec({ taskId: 'task-uuid-2', payload: { title: 'Старая задача' } })],
      total: 1, hasMore: false, loadMore, reload,
    };
    storeState.tasks = [{ id: 7, uuid: 'task-uuid-2', title: 'Старая задача', deleted_at: '2026-01-01T00:00:00Z' }];
    render(<WorkspaceHistoryTab />);
    expect(screen.getByText(/\(удалена\)/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Старая задача/i })).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('задача отсутствует локально — тоже «(удалена)» с payload-title', () => {
    hookResult = {
      records: [rec({ taskId: 'gone', payload: { title: 'Забытая' } })],
      total: 1, hasMore: false, loadMore, reload,
    };
    storeState.tasks = [];
    render(<WorkspaceHistoryTab />);
    expect(screen.getByText(/Забытая/)).toBeTruthy();
    expect(screen.getByText(/\(удалена\)/i)).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('WorkspaceHistoryTab — кнопка «Обновить»', () => {
  it('кнопка — только иконка: доступное имя из aria-label, без видимой подписи', () => {
    render(<WorkspaceHistoryTab />);
    const btn = screen.getByRole('button', { name: 'Обновить' });
    expect(btn).toHaveAttribute('aria-label', 'Обновить');
    expect(btn).toHaveAttribute('title', 'Обновить');
    // Текстовой подписи в кнопке нет — внутри только svg-иконка.
    expect(btn.textContent).toBe('');
    expect(btn.querySelector('svg')).toBeTruthy();
  });

  it('клик вызывает reload из стора', async () => {
    render(<WorkspaceHistoryTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Обновить' }));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  it('во время загрузки кнопка disabled со спиннером, повторный клик игнорируется', async () => {
    // reload «висит» до ручного резолва — эмулируем длительную загрузку.
    let release!: () => void;
    reload.mockImplementation(() => new Promise<void>((res) => { release = res; }));

    render(<WorkspaceHistoryTab />);
    const btn = screen.getByRole('button', { name: 'Обновить' });
    fireEvent.click(btn);

    await waitFor(() => expect(btn).toBeDisabled());
    expect(btn.querySelector('svg')?.getAttribute('class')).toContain('animate-spin');

    // Даблклик по disabled-кнопке не приводит ко второй загрузке.
    fireEvent.click(btn);
    expect(reload).toHaveBeenCalledTimes(1);

    await act(async () => { release(); });
    expect(btn).not.toBeDisabled();
    expect(btn.querySelector('svg')?.getAttribute('class')).not.toContain('animate-spin');
  });

  it('EN-локаль: aria-label/title = Refresh', () => {
    storeState.language = 'en';
    render(<WorkspaceHistoryTab />);
    expect(screen.getByRole('button', { name: 'Refresh' })).toHaveAttribute('title', 'Refresh');
  });
});
