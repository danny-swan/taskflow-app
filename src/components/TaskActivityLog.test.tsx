// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// Рендер-тесты TaskActivityLog (Wave C, PR-c-03): свёрнуто по умолчанию,
// разворот вызывает загрузку, резолв автора (вы/presence-ник/короткий id),
// пустое состояние, «Показать ещё» и кнопка-иконка «Обновить».
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import type { ActivityRecord } from '../store/useTaskActivityStore';

let storeState: any;
let presenceState: any;
let activityResult: any;
const loadMore = vi.fn();
const reload = vi.fn();
// v0.9.26: кнопка «Обновить» теперь сначала дёргает syncNow() (pull с сервера),
// потом reload() из зеркала. Мокаем syncNow — по умолчанию мгновенный resolve.
const syncNow = vi.fn(async () => ({}) as any);

vi.mock('../store/useStore', () => ({
  useStore: (selector: (s: any) => unknown) => selector(storeState),
}));
vi.mock('../store/usePresenceStore', () => ({
  usePresenceStore: (selector: (s: any) => unknown) => selector(presenceState),
}));
vi.mock('../store/useTaskActivityStore', () => ({
  useTaskActivity: (taskUuid: string | null | undefined) => {
    // Пустой результат, пока секция свёрнута (taskUuid=null).
    if (!taskUuid) return { records: [], hasMore: false, loadMore, reload };
    return activityResult;
  },
}));

vi.mock('../lib/sync', () => ({
  syncNow: () => syncNow(),
}));

import { TaskActivityLog } from './TaskActivityLog';

function rec(over: Partial<ActivityRecord> = {}): ActivityRecord {
  return {
    id: `log-${Math.random().toString(36).slice(2)}`,
    taskId: 't1',
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
  reload.mockReset();
  syncNow.mockReset();
  syncNow.mockImplementation(async () => ({}) as any);
  storeState = { language: 'ru', boundUserId: 'me-uuid' };
  presenceState = { byId: {} };
  activityResult = { records: [], hasMore: false, loadMore, reload };
});

describe('TaskActivityLog', () => {
  it('свёрнут по умолчанию — записи не отрендерены', () => {
    activityResult = { records: [rec()], hasMore: false, loadMore, reload };
    render(<TaskActivityLog taskUuid="t1" />);
    // Заголовок-кнопка есть, но список ещё не раскрыт.
    expect(screen.getByRole('button', { name: /История изменений/i })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('разворот показывает пустое состояние', () => {
    render(<TaskActivityLog taskUuid="t1" />);
    fireEvent.click(screen.getByRole('button', { name: /История изменений/i }));
    expect(screen.getByText(/Пока нет изменений/i)).toBeTruthy();
  });

  it('автор «вы» когда userId === boundUserId', () => {
    activityResult = { records: [rec({ userId: 'me-uuid' })], hasMore: false, loadMore, reload };
    render(<TaskActivityLog taskUuid="t1" />);
    fireEvent.click(screen.getByRole('button', { name: /История изменений/i }));
    expect(screen.getByText('вы')).toBeTruthy();
  });

  it('автор — ник из presence', () => {
    presenceState = { byId: { 'author-uuid-1234567890': { nickname: 'Алиса', publicUserId: 'TF-AAA11', avatarVariant: 3 } } };
    activityResult = { records: [rec()], hasMore: false, loadMore, reload };
    render(<TaskActivityLog taskUuid="t1" />);
    fireEvent.click(screen.getByRole('button', { name: /История изменений/i }));
    expect(screen.getByText('Алиса')).toBeTruthy();
  });

  it('офлайн-автор — короткий id (не email)', () => {
    activityResult = { records: [rec({ userId: 'abcdef01-2345-6789' })], hasMore: false, loadMore, reload };
    render(<TaskActivityLog taskUuid="t1" />);
    fireEvent.click(screen.getByRole('button', { name: /История изменений/i }));
    expect(screen.getByText('abcdef01')).toBeTruthy();
  });

  it('«Показать ещё» рендерится и дёргает loadMore', () => {
    activityResult = { records: [rec()], hasMore: true, loadMore, reload };
    render(<TaskActivityLog taskUuid="t1" />);
    fireEvent.click(screen.getByRole('button', { name: /История изменений/i }));
    const more = screen.getByRole('button', { name: /Показать ещё/i });
    fireEvent.click(more);
    expect(loadMore).toHaveBeenCalledTimes(1);
  });

  it('нет «Показать ещё» когда hasMore=false', () => {
    activityResult = { records: [rec()], hasMore: false, loadMore, reload };
    render(<TaskActivityLog taskUuid="t1" />);
    fireEvent.click(screen.getByRole('button', { name: /История изменений/i }));
    expect(screen.queryByRole('button', { name: /Показать ещё/i })).toBeNull();
  });
});

describe('TaskActivityLog — кнопка «Обновить»', () => {
  /** Разворачивает секцию и возвращает icon-кнопку обновления. */
  function openAndGetRefresh(): HTMLElement {
    render(<TaskActivityLog taskUuid="t1" />);
    fireEvent.click(screen.getByRole('button', { name: /История изменений/i }));
    return screen.getByRole('button', { name: 'Обновить' });
  }

  it('в свёрнутом виде кнопки нет', () => {
    render(<TaskActivityLog taskUuid="t1" />);
    expect(screen.queryByRole('button', { name: 'Обновить' })).toBeNull();
  });

  it('кнопка — только иконка: доступное имя из aria-label, без видимой подписи', () => {
    const btn = openAndGetRefresh();
    expect(btn).toHaveAttribute('aria-label', 'Обновить');
    expect(btn).toHaveAttribute('title', 'Обновить');
    // Текстовой подписи в кнопке нет — внутри только svg-иконка.
    expect(btn.textContent).toBe('');
    expect(btn.querySelector('svg')).toBeTruthy();
  });

  it('клик вызывает reload из стора', async () => {
    const btn = openAndGetRefresh();
    fireEvent.click(btn);
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  it('во время загрузки кнопка disabled со спиннером, повторный клик игнорируется', async () => {
    // v0.9.26: теперь длительная часть — syncNow (pull с сервера). «Висит» до ручного
    // резолва — эмулируем длительный сетевой pull.
    let release!: () => void;
    syncNow.mockImplementation(() => new Promise<any>((res) => { release = () => res({}); }));

    const btn = openAndGetRefresh();
    fireEvent.click(btn);

    await waitFor(() => expect(btn).toBeDisabled());
    expect(btn.querySelector('svg')?.getAttribute('class')).toContain('animate-spin');

    // Даблклик по disabled-кнопке не приводит ко второму pull.
    fireEvent.click(btn);
    expect(syncNow).toHaveBeenCalledTimes(1);

    await act(async () => { release(); });
    expect(btn).not.toBeDisabled();
    expect(btn.querySelector('svg')?.getAttribute('class')).not.toContain('animate-spin');
    // После завершения pull — локальный reload из зеркала.
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('EN-локаль: aria-label/title = Refresh', () => {
    storeState = { language: 'en', boundUserId: 'me-uuid' };
    render(<TaskActivityLog taskUuid="t1" />);
    fireEvent.click(screen.getByRole('button', { name: /Activity/i }));
    expect(screen.getByRole('button', { name: 'Refresh' })).toHaveAttribute('title', 'Refresh');
  });
});
